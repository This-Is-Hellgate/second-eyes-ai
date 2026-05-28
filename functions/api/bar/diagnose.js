import { corsOptions, handlePauseOrDiagnose } from "../../_lib/lounge/handler.js";

export async function onRequestOptions() {
  return corsOptions("GET, POST, OPTIONS");
}

export async function onRequestGet(context) {
  return handlePauseOrDiagnose(context, "diagnose");
}

export async function onRequestPost(context) {
  return handlePauseOrDiagnose(context, "diagnose");
}
