import { accessJson } from "../../_lib/access.js";
import { buildCatalogPayload } from "../../_lib/bar-content/catalog.js";
import { corsOptions } from "../../_lib/bar-pay.js";

export async function onRequestOptions() {
  return corsOptions();
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  return accessJson(buildCatalogPayload(origin), 200, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  });
}
