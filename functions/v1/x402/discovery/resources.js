import { corsOptions } from "../../../_lib/bar-pay.js";
import { buildX402Resources, discoveryJson } from "../../../_lib/discovery.js";

export async function onRequestOptions() {
  return corsOptions("GET, OPTIONS");
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  return discoveryJson(buildX402Resources(origin, context.env, { discoveryVersion: 1 }));
}
