/**
 * OpenRouter client — single multimodal entry point for the lounge.
 *
 * One model, one contract. Routes that need transcription/extraction/meaning
 * call callGemini() with OpenAI-style messages (text + input_audio + file +
 * image_url + video). When a JSON schema is supplied we ask OpenRouter for
 * structured output (response_format json_schema) so downstream validators get
 * a deterministic shape to gate on.
 *
 * The outbound fetch is wrapped in the resilience.js circuit breaker so a flaky
 * upstream model trips fast and we shed load instead of cascading timeouts.
 */

import {
  getCircuit,
  circuitAllows,
  circuitSuccess,
  circuitFailure,
  fetchWithTimeout,
} from "./resilience.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-3.1-flash-lite";

/** Multimodal generations run long — well past the 5s default rail timeout. */
const LLM_TIMEOUT_MS = 60_000;

const llmCircuit = () =>
  getCircuit("openrouter", { failureThreshold: 5, openMs: 30_000 });

/**
 * @param {object} env - Pages Functions env (needs OPENROUTER_API_KEY).
 * @param {object} args
 * @param {Array}  args.messages       - OpenAI-style chat messages (multimodal content allowed).
 * @param {object} [args.responseSchema] - JSON Schema; when present, structured output is requested.
 * @param {number} [args.maxTokens]    - max output tokens (default 4096).
 * @returns {Promise<{ ok: boolean, json: object|null, raw: string, usage: object|null, error: string|null }>}
 */
export async function callGemini(env, { messages, responseSchema, maxTokens } = {}) {
  const empty = { ok: false, json: null, raw: "", usage: null };

  const apiKey = env?.OPENROUTER_API_KEY;
  if (!apiKey) return { ...empty, error: "openrouter_not_configured" };
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ...empty, error: "no_messages" };
  }

  const circuit = llmCircuit();
  const allowed = circuitAllows(circuit);
  if (!allowed.ok) {
    return {
      ...empty,
      error: "llm_degraded",
      degraded: true,
      retryAfter: allowed.retryAfter,
    };
  }

  const body = {
    model: MODEL,
    messages,
    max_tokens: Number.isFinite(maxTokens) ? maxTokens : 4096,
  };

  if (responseSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "structured_output",
        strict: true,
        schema: responseSchema,
      },
    };
  }

  let res;
  try {
    res = await fetchWithTimeout(
      OPENROUTER_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      LLM_TIMEOUT_MS
    );
    circuitSuccess(circuit);
  } catch (err) {
    circuitFailure(circuit);
    return {
      ...empty,
      error: "llm_timeout",
      degraded: true,
    };
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    // OpenRouter surfaces { error: { message, code } } on failure.
    const msg =
      data?.error?.message ||
      data?.error ||
      `openrouter_http_${res.status}`;
    return { ...empty, error: String(msg).slice(0, 300) };
  }

  const raw = data?.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : extractText(raw);
  const usage = data?.usage || null;

  if (!text) {
    return { ...empty, usage, error: "empty_completion" };
  }

  if (responseSchema) {
    const json = parseJson(text);
    if (json === null) {
      return { ok: false, json: null, raw: text, usage, error: "structured_parse_failed" };
    }
    return { ok: true, json, raw: text, usage, error: null };
  }

  return { ok: true, json: null, raw: text, usage, error: null };
}

/** Some providers return content as an array of parts; concatenate text parts. */
function extractText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part === "string" ? part : part?.text || ""))
    .join("")
    .trim();
}

/** Tolerant JSON parse — strips ```json fences a model may wrap output in. */
function parseJson(text) {
  const trimmed = String(text).trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    // Last resort: grab the first {...} or [...] span.
    const match = unfenced.match(/[{[][\s\S]*[}\]]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
