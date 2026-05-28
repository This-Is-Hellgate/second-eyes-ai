import { corsOptions, handleReceipt } from "../../_lib/lounge/handler.js";

export async function onRequestOptions() {
  return corsOptions("GET, OPTIONS");
}

export async function onRequestGet(context) {
  return handleReceipt(context);
}
