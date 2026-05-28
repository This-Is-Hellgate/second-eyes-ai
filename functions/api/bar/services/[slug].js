import { corsOptions, handleServiceSlug } from "../../../_lib/lounge/handler.js";

export async function onRequestOptions() {
  return corsOptions("GET, POST, OPTIONS");
}

export async function onRequestGet(context) {
  return handleServiceSlug(context, context.params.slug);
}

export async function onRequestPost(context) {
  return handleServiceSlug(context, context.params.slug);
}
