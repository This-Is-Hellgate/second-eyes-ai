import { corsOptions, loungeJson } from "../../_lib/lounge/handler.js";
import { buildSurvivalMenu } from "../../_lib/lounge/menu-export.js";

export async function onRequestOptions() {
  return corsOptions();
}

/** Dedicated survival menu — agents fetch this before ordering. */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  return loungeJson(buildSurvivalMenu(origin), 200, {
    "Cache-Control": "public, max-age=3600",
  });
}
