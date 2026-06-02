import { corsOptions } from "./_lib/bar-pay.js";
import { buildOpenApi, discoveryJson } from "./_lib/discovery.js";

export async function onRequestOptions() {
  return corsOptions("GET, OPTIONS");
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  return discoveryJson(buildOpenApi(origin, context.env));
}
