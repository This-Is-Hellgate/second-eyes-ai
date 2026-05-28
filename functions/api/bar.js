import { accessJson } from "../_lib/access.js";
import { buildAgentEntry } from "../_lib/agent-entry.js";
import { corsOptions } from "../_lib/bar-pay.js";

/** Agent front door — fetch this before anything else. */
export async function onRequestOptions() {
  return corsOptions("GET, OPTIONS");
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;

  return accessJson(buildAgentEntry(origin), 200, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  });
}
