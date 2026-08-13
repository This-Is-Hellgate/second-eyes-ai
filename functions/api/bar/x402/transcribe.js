export async function onRequestGet(context) { return redirect(context); }
export async function onRequestPost(context) { return redirect(context); }
export async function onRequestOptions() { return new Response(null, { status: 204, headers: { Allow: "GET, POST, OPTIONS", "Access-Control-Allow-Origin": "*" } }); }
function redirect(context) { const url = new URL(context.request.url); url.pathname = "/api/bar/x402/analyze-video-audio-and-pdfs"; return Response.redirect(url.toString(), 308); }
