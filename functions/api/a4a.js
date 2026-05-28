import { handleA4AJsonRpc, wantsA4AExtension, a4aExtensionHeader } from "../_lib/a4a.js";

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, X-A2A-Extensions, PAYMENT-SIGNATURE, X-PAYMENT-SIGNATURE",
      "Access-Control-Max-Age": "86400",
    },
  });
}

/** A4A merchant endpoint — A2A JSON-RPC + x402 extension for agent payment. */
export async function onRequestPost(context) {
  if (!wantsA4AExtension(context.request)) {
    return new Response(
      JSON.stringify({
        error: "A4A/x402 requires X-A2A-Extensions header",
        extension: "https://github.com/google-a2a/a2a-x402/v0.1",
        agentCard: "/.well-known/agent-card.json",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...a4aExtensionHeader() },
      }
    );
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } }),
      { status: 400, headers: { "Content-Type": "application/json", ...a4aExtensionHeader() } }
    );
  }

  return handleA4AJsonRpc(body, context.request, context.env);
}
