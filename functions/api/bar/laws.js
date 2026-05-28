import { corsOptions, lawsPayload, loungeJson } from "../../_lib/lounge/handler.js";

export async function onRequestOptions() {
  return corsOptions();
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  return loungeJson(lawsPayload(origin), 200, {
    "Cache-Control": "public, max-age=3600",
  });
}
