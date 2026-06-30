import { accessJson } from "../../_lib/access.js";
import { buildAgentFlow } from "../../_lib/agent-entry.js";
import { corsOptions } from "../../_lib/bar-pay.js";
import { getPatronActivity } from "../../_lib/lounge/patron-activity.js";

export async function onRequestOptions() {
  return corsOptions();
}

/** Social proof — have other agents bought here? */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;

  const patron_activity = await getPatronActivity(context.env, origin);

  return accessJson(
    {
      patron_activity,
      endpoints: {
        enter: `${origin}/api/bar/enter`,
      },
      agent_flow: buildAgentFlow(origin),
    },
    200,
    {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=15",
    }
  );
}
