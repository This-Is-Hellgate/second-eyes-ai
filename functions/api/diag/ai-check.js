export async function onRequestGet(context) {
  const { env } = context;
  const results = {};

  try {
    const res = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
      messages: [
        { role: "system", content: "Respond with ONLY a JSON object: {\"ok\": true, \"note\": \"<one short sentence>\"}" },
        { role: "user", content: "Confirm you are working." }
      ],
      max_tokens: 200
    });
    const raw = typeof res === "string" ? res : (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || res.response || res.result || "";
    results.gemma = { ok: true, raw: String(raw).slice(0, 300) };
  } catch (err) {
    results.gemma = { ok: false, error: String(err && err.message || err) };
  }

  try {
    const bytes = new TextEncoder().encode("Hello world, this is a diagnostic test document.");
    const out = await env.AI.toMarkdown([{ name: "test.txt", blob: new Blob([bytes], { type: "text/plain" }) }]);
    const md = Array.isArray(out) ? out[0] && out[0].data : (out && out.data);
    results.toMarkdown = { ok: !!md, data: md ? String(md).slice(0, 200) : null };
  } catch (err) {
    results.toMarkdown = { ok: false, error: String(err && err.message || err) };
  }

  try {
    const sampleRate = 8000, numSamples = 800;
    const dataSize = numSamples * 2;
    const buf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buf);
    function writeStr(off, s) { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }
    writeStr(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); writeStr(8, "WAVE");
    writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    writeStr(36, "data"); view.setUint32(40, dataSize, true);
    const u8 = new Uint8Array(buf);
    let b64 = ""; const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) b64 += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    const audioB64 = btoa(b64);
    const res = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: audioB64 });
    results.whisper = { ok: true, raw: JSON.stringify(res).slice(0, 300) };
  } catch (err) {
    results.whisper = { ok: false, error: String(err && err.message || err) };
  }

  try {
    if (!env.MEDIA_BANK || !env.DB) throw new Error("MEDIA_BANK or DB binding missing");
    const key = "diag/test-" + Date.now() + ".txt";
    await env.MEDIA_BANK.put(key, "diagnostic write test");
    const obj = await env.MEDIA_BANK.get(key);
    const text = obj ? await obj.text() : null;
    await env.MEDIA_BANK.delete(key);
    const d1check = await env.DB.prepare("select 1 as ok").first();
    results.storage = { ok: text === "diagnostic write test", r2_readback: text, d1_ok: !!d1check };
  } catch (err) {
    results.storage = { ok: false, error: String(err && err.message || err) };
  }

  return new Response(JSON.stringify(results, null, 2), { headers: { "Content-Type": "application/json" } });
}