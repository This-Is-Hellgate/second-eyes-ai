import { corsOptions } from "./_lib/bar-pay.js";
import { buildApiDocsPointer, discoveryJson } from "./_lib/discovery.js";

export async function onRequestOptions() {
  return corsOptions("GET, OPTIONS");
}

/**
 * Agents probe /api-docs expecting a console; there is none (agent-only surface).
 * Return a machine-readable pointer to the OpenAPI document instead of a 404.
 */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  return discoveryJson(buildApiDocsPointer(origin), {
    Link: `<${origin}/openapi.json>; rel="describedby"; type="application/json"`,
  });
}
