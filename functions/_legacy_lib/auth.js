import { json } from "./review.js";

export function authorize(request, env) {
  const token = env.REVIEW_TOKEN;
  if (!token) {
    return { ok: false, response: json({ error: "Review API not configured." }, 503) };
  }

  const header = request.headers.get("Authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const query = new URL(request.url).searchParams.get("token") || "";

  if (bearer === token || query === token) {
    return { ok: true };
  }

  return { ok: false, response: json({ error: "Unauthorized" }, 401) };
}

export function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "https://secondeyesai.com",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
