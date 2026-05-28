import { accessJson } from "../_lib/access.js";
import { buildAgentEntry } from "../_lib/agent-entry.js";
import { corsOptions } from "../_lib/bar-pay.js";
import { handleMcpPost, mcpJsonResponse } from "../_lib/mcp-facade.js";

/** Agent front door — GET. Streamable-HTTP MCP facade — POST (Smithery/registry scanners). */
export async function onRequestOptions() {
  return corsOptions("GET, POST, OPTIONS");
}

export async function onRequestPost(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  const { status, payload } = await handleMcpPost(context.request, origin);
  if (payload === null) {
    return new Response(null, { status, headers: { "Access-Control-Allow-Origin": "*" } });
  }
  return mcpJsonResponse(payload, status);
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;

  return accessJson(buildAgentEntry(origin), 200, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  });
}
