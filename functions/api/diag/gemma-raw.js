export async function onRequestGet(context) {
  const { env } = context;
  try {
    const res = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
      messages: [
        { role: "system", content: "Respond with ONLY a JSON object: {\"ok\": true, \"note\": \"<one short sentence>\"}" },
        { role: "user", content: "Confirm you are working." }
      ],
      max_tokens: 200
    });
    return new Response(JSON.stringify({ full_raw_response: res, typeof_res: typeof res }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err && err.message || err), stack: String(err && err.stack || "") }, null, 2), { headers: { "Content-Type": "application/json" } });
  }
}