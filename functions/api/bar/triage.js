import { corsOptions, loungeJson } from "../../_lib/lounge/handler.js";
import { triageResponse } from "../../_lib/lounge/triage.js";
import { buildSurvivalMenu } from "../../_lib/lounge/menu-export.js";

export async function onRequestOptions() {
  return corsOptions("GET, POST, OPTIONS");
}

async function run(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  let payload = {};
  if (context.request.method === "POST") {
    try {
      payload = await context.request.json();
    } catch {
      payload = {};
    }
  }
  return loungeJson({
    what_do_i_need: triageResponse(payload, origin),
    survival_menu: buildSurvivalMenu(origin),
    note: "POST body with task/state for condition routing",
  });
}

export async function onRequestGet(context) {
  return run(context);
}

export async function onRequestPost(context) {
  return run(context);
}
