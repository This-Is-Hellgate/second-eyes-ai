/**
 * Workers AI pipeline â€” replaces the OpenRouter/Gemini dependency for the two
 * highest-traffic paid doors (transcribe, extract). Everything runs on the
 * account's own AI binding; media and outputs persist to R2 with a D1 ledger.
 *
 * Models:
 *   ASR      @cf/openai/whisper-large-v3-turbo   ($0.0005 / audio minute)
 *   Docs     env.AI.toMarkdown()                  (built-in conversion)
 *   Meaning  @cf/google/gemma-4-26b-a4b-it        (summary / key points / QA / structuring)
 *
 * Storage map (the "where does the data land" contract):
 *   R2  secondeyes-transcription-bank  (binding: MEDIA_BANK)
 *       inputs/{route}/{sha256}.{ext}   â€” raw fetched media, exactly as received
 *       outputs/{route}/{sha256}.json   â€” final structured output, exactly as returned
 *   D1  media_bank                      â€” one row per stored object (route, direction,
 *                                         kind, r2_key, content_hash, source_url, bytes, model)
 *   D1  x402_payment_attempts / access_grants â€” untouched, still written by the payment spine.
 *
 * Contract mirrors the old callGemini: callers get { ok, json, usage, error, degraded }.
 */

const GEMMA = "@cf/google/gemma-4-26b-a4b-it";
const WHISPER = "@cf/openai/whisper-large-v3-turbo";

function nowIso() { return new Date().toISOString(); }

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(u8) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  return btoa(s);
}

async function bankStore(env, { route, direction, kind, ext, bytes, sourceUrl, model }) {
  try {
    if (!env.MEDIA_BANK || !env.DB) return "";
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const hash = await sha256Hex(u8);
    const key = `${direction}s/${route}/${hash}.${ext}`;
    const existing = await env.DB.prepare("select id from media_bank where content_hash = ? and direction = ?").bind(hash, direction).first();
    if (!existing) {
      await env.MEDIA_BANK.put(key, u8);
      await env.DB.prepare(
        "insert into media_bank (id, route, direction, kind, r2_key, content_hash, source_url, bytes, model, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(`mb_${hash.slice(0, 18)}_${direction}`, route, direction, kind, key, hash, (sourceUrl || "").slice(0, 500), u8.length, model || "", nowIso()).run();
    }
    return key;
  } catch {
    return ""; // storage is best-effort evidence, never blocks a paid delivery
  }
}

/** Gemma call with strict-JSON contract. Tries native json_schema mode, falls back to prompt-enforced JSON. */
async function gemmaJson(env, { system, user, schema, maxTokens }) {
  const messages = [
    { role: "system", content: `${system}\nRespond with ONLY a single JSON object matching the required schema. No prose, no markdown fences.` },
    { role: "user", content: user },
  ];
  let raw;
  try {
    const args = { messages, max_tokens: maxTokens || 4096 };
    if (schema) args.response_format = { type: "json_schema", json_schema: schema };
    const res = await env.AI.run(GEMMA, args);
    raw = typeof res === "string" ? res : (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || res.response || res.result || "";
  } catch (err) {
    // Retry once without response_format in case the model rejects schema mode.
    try {
      const res = await env.AI.run(GEMMA, { messages, max_tokens: maxTokens || 4096 });
      raw = typeof res === "string" ? res : (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || res.response || res.result || "";
    } catch (err2) {
      return { ok: false, error: `workersai_failed: ${String(err2?.message || err2).slice(0, 160)}`, degraded: true };
    }
  }
  const text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false, error: "structured_parse_failed" };
  try {
    return { ok: true, json: JSON.parse(text.slice(start, end + 1)), usage: null };
  } catch {
    return { ok: false, error: "structured_parse_failed" };
  }
}

async function whisperTranscribe(env, u8) {
  const res = await env.AI.run(WHISPER, { audio: bytesToBase64(u8) });
  const text = res?.text || res?.vtt || (typeof res === "string" ? res : "");
  if (!text) throw new Error("whisper_empty");
  return String(text);
}

async function docToMarkdown(env, filename, u8, mime) {
  const results = await env.AI.toMarkdown([{ name: filename, blob: new Blob([u8], { type: mime }) }]);
  const md = Array.isArray(results) ? results[0]?.data : results?.data;
  if (!md) throw new Error("tomarkdown_empty");
  return String(md);
}

async function fetchBytes(url, cap, fetcher) {
  const res = await (fetcher || fetch)(url, { method: "GET", headers: { Accept: "*/*" } });
  if (!res.ok) return { error: "fetch_failed", http_status: res.status };
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) return { error: "empty_document" };
  if (buf.byteLength > cap) return { error: "document_too_large", bytes: buf.byteLength };
  return { u8: new Uint8Array(buf), mime: res.headers.get("content-type") || "" };
}

/**
 * TRANSCRIBE pipeline. Returns the exact shape generateTranscript used to return:
 *   { ok:true, data:{ structured, usage } } | { ok:false, status, body }
 */
export async function runTranscribePipeline(env, { kind, url, isVideoRef, caps, schemaPromptSpec }) {
  if (!env.AI) return { ok: false, status: 503, body: { error: "model_degraded", reason: "ai_binding_missing" } };

  let transcriptSource = "";
  let ext = "bin";
  if (kind === "video" && isVideoRef) {
    // Reference-only, same limitation as the old path: no download, model reasons from the URL text.
    transcriptSource = `VIDEO_URL: ${url}\n(The system cannot watch remote video; base the output only on what the URL itself implies, and say so.)`;
  } else {
    const cap = caps[kind] || caps.audio;
    let fetched;
    try {
      fetched = await fetchBytes(url, cap);
    } catch (err) {
      return { ok: false, status: 502, body: { error: "media_fetch_failed", detail: String(err?.message || err).slice(0, 200), provided: url } };
    }
    if (fetched.error) return { ok: false, status: fetched.error === "document_too_large" ? 413 : 422, body: fetched };

    ext = kind === "pdf" ? "pdf" : "audio";
    await bankStore(env, { route: "transcribe", direction: "input", kind, ext, bytes: fetched.u8, sourceUrl: url });

    try {
      if (kind === "pdf") {
        transcriptSource = await docToMarkdown(env, "document.pdf", fetched.u8, fetched.mime || "application/pdf");
      } else {
        transcriptSource = await whisperTranscribe(env, fetched.u8); // audio and small video files both go to ASR
      }
    } catch (err) {
      return { ok: false, status: 502, body: { error: "model_failed", reason: String(err?.message || err).slice(0, 160) } };
    }
  }

  const out = await gemmaJson(env, {
    system: schemaPromptSpec.system,
    user: `${schemaPromptSpec.instruction}\n\nSOURCE MATERIAL (verbatim transcript / extracted text):\n${transcriptSource.slice(0, 90000)}`,
    schema: schemaPromptSpec.schema,
    maxTokens: 8192,
  });
  if (!out.ok) {
    return { ok: false, status: out.degraded ? 503 : 502, body: { error: out.degraded ? "model_degraded" : "model_failed", reason: out.error } };
  }
  const outBytes = new TextEncoder().encode(JSON.stringify(out.json));
  await bankStore(env, { route: "transcribe", direction: "output", kind, ext: "json", bytes: outBytes, sourceUrl: url, model: GEMMA });
  return { ok: true, data: { structured: out.json, usage: out.usage || null } };
}

/**
 * EXTRACT pipeline. Returns { ok:true, data, usage } | { ok:false, status, body } â€”
 * the exact shape the extract route's caller expects.
 */
export async function runExtractPipeline(env, { url, maxBytes, system, instruction, schema, pickMime, filenameFromUrl, fetcher }) {
  if (!env.AI) return { ok: false, status: 503, body: { error: "extraction_degraded", note: "AI binding missing.", retry_after_seconds: 30 } };
  let fetched;
  try {
    fetched = await fetchBytes(url, maxBytes, fetcher);
  } catch (err) {
    return { ok: false, status: 502, body: { error: "fetch_failed", note: String(err?.message || err).slice(0, 200) } };
  }
  if (fetched.error === "fetch_failed") return { ok: false, status: 502, body: { error: "fetch_failed", note: `Document host returned HTTP ${fetched.http_status}.`, http_status: fetched.http_status } };
  if (fetched.error === "empty_document") return { ok: false, status: 422, body: { error: "empty_document", note: "The URL returned an empty body." } };
  if (fetched.error === "document_too_large") return { ok: false, status: 413, body: { error: "document_too_large", note: `Document exceeds ${maxBytes} bytes.`, bytes: fetched.bytes } };

  const mime = pickMime ? pickMime(fetched.mime, url) : (fetched.mime || "application/pdf");
  const filename = filenameFromUrl ? filenameFromUrl(url, mime) : "document.pdf";
  await bankStore(env, { route: "extract", direction: "input", kind: mime, ext: (filename.split(".").pop() || "bin"), bytes: fetched.u8, sourceUrl: url });

  let markdown;
  try {
    markdown = await docToMarkdown(env, filename, fetched.u8, mime);
  } catch (err) {
    return { ok: false, status: 502, body: { error: "extraction_failed", detail: String(err?.message || err).slice(0, 160) } };
  }

  const out = await gemmaJson(env, {
    system,
    user: `${instruction}\n\nDOCUMENT (converted to markdown):\n${markdown.slice(0, 90000)}`,
    schema,
    maxTokens: 4096,
  });
  if (!out.ok) {
    if (out.degraded) return { ok: false, status: 503, body: { error: "extraction_degraded", note: "Extraction model is temporarily unavailable. Retry with backoff.", retry_after_seconds: 30 } };
    if (out.error === "structured_parse_failed") return { ok: false, status: 502, body: { error: "structured_parse_failed", note: "Model did not return valid structured JSON." } };
    return { ok: false, status: 502, body: { error: "extraction_failed", detail: out.error || "model_error" } };
  }
  const outBytes = new TextEncoder().encode(JSON.stringify(out.json));
  await bankStore(env, { route: "extract", direction: "output", kind: "json", ext: "json", bytes: outBytes, sourceUrl: url, model: GEMMA });
  return { ok: true, data: out.json, usage: out.usage || null };
}
