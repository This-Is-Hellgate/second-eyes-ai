import { corsOptions, handleLeave } from "../../_lib/lounge/handler.js";

export async function onRequestOptions() {
  return corsOptions("GET, POST, OPTIONS");
}

export async function onRequestGet(context) {
  return handleLeave(context);
}

export async function onRequestPost(context) {
  return handleLeave(context);
}
