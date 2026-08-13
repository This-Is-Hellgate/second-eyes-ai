export async function onRequestGet(context) { return redirect(context); }
export async function onRequestPost(context) { return redirect(context); }
export async function onRequestOptions() { return new Response(null, { status: 204, headers: { Allow: "GET, POST, OPTIONS", "Access-Control-Allow-Origin": "*" } }); }
function redirect(context) { const url = new URL(context.request.url); url.pathname = "/api/bar/x402/turn-paper-into-code"; if (url.searchParams.has("url") && !url.searchParams.has("paper_url")) { url.searchParams.set("paper_url", url.searchParams.get("url")); url.searchParams.delete("url"); } return Response.redirect(url.toString(), 308); }
