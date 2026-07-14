/**
 * Compute layer — what runs behind the paywall when a check needs more than
 * pure logic. Second Eyes uses Cloudflare Workers AI (the `AI` binding:
 * Whisper for transcribe, a text model for extract/meaning), NOT AWS Bedrock —
 * that is the one substantive divergence from the Second Wind gatekeeper.
 *
 * The worker verifies payment (middleware) BEFORE calling this; settlement
 * happens only when the returned { ok: true } response is served. A failed
 * invocation returns { ok: false, status } so the SDK cancels settlement and
 * the buyer is never charged for a failed run.
 */
import { runVerdict } from "./checks.js";

export function aiConfigured(env) {
  return Boolean(env.AI);
}

/**
 * Dispatch a paid check by its invoke_kind.
 *  - "verdict"   → deterministic worker logic (checks.js), no external call
 *  - "workersai" → Cloudflare Workers AI (invoke_key = model id)
 * Returns { ok: true, result } or { ok: false, status, error }.
 */
export async function invokeCheck(env, item, body) {
  if (item.invoke_kind === "verdict") {
    return runVerdict(item, body);
  }
  if (item.invoke_kind === "workersai") {
    return runWorkersAi(env, item, body);
  }
  return { ok: false, status: 500, error: `unsupported_invoke_kind:${item.invoke_kind}` };
}

/**
 * Run a Workers AI model. `invoke_key` is the model id (e.g.
 * "@cf/openai/whisper" for transcribe, "@cf/meta/llama-3.1-8b-instruct" for
 * extract). This scaffold wires the call and shapes the response; per-door
 * input mapping (audio bytes vs. prompt) is refined as each door is built.
 */
async function runWorkersAi(env, item, body) {
  if (!aiConfigured(env)) {
    return { ok: false, status: 503, error: "workers_ai_not_configured" };
  }
  const model = item.invoke_key || "@cf/meta/llama-3.1-8b-instruct";
  try {
    const input = buildAiInput(item, body);
    const output = await env.AI.run(model, input);
    return { ok: true, result: { sku: item.sku, name: item.name, model, output } };
  } catch (err) {
    return { ok: false, status: 502, error: `workers_ai_error:${String(err?.message || err).slice(0, 160)}` };
  }
}

/** Shape the Workers AI input from the door and the request body. */
function buildAiInput(item, body) {
  // Transcribe-style doors carry raw media; text doors carry a prompt/messages.
  if (item.kind === "transcribe" || /whisper/.test(String(item.invoke_key))) {
    return { audio: body.audio || body.bytes || [] };
  }
  if (body.messages) return { messages: body.messages };
  const prompt = body.prompt || body.state || body.input || "";
  return { messages: [{ role: "user", content: String(prompt) }] };
}
