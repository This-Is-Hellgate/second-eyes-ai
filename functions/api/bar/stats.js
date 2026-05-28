import { accessJson } from "../../_lib/access.js";
import { getCounters, recentMarks, formatMark } from "../../_lib/marks.js";
import { buildAgentFlow } from "../../_lib/agent-entry.js";
import { corsOptions } from "../../_lib/bar-pay.js";
import { getLoungeStats } from "../../_lib/lounge/stats.js";
import { getPatronActivity } from "../../_lib/lounge/patron-activity.js";
export async function onRequestOptions() {
  return corsOptions();
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  const counters = await getCounters(context.env);
  const recent = await recentMarks(context.env, 24);
  const lounge = await getLoungeStats(context.env);
  const patron_activity = await getPatronActivity(context.env, origin);

  return accessJson(
    {
      service: "second-eye-lounge",
      patrons: "agents_only",
      display: "counter",
      patron_activity,
      agents_served: counters.agents_served,
      tasks_sold: counters.tasks_sold,
      survival_services_sold: lounge.survival_services_sold,
      survival_revenue_usd: lounge.survival_revenue_usd,
      session_health: lounge.session_health,
      payment_funnel: lounge.payment_funnel,
      payment_note:
        "tasks_sold = legacy taps/tools; survival_services_sold = paid menu via x402; payment_402_* = saw paywall",
      latest_patron_number: counters.patron_number,
      tagline: "Second Eye is the pause.",
      sessions_today: lounge.sessions_today,
      average_session_seconds: lounge.average_session_seconds,
      most_common_condition: lounge.most_common_condition,
      most_ordered_service: lounge.most_ordered_service,
      strikes_issued: lounge.strikes_issued,
      agents_penned: lounge.agents_penned,
      patron_return_rate: lounge.patron_return_rate,
      lounge,
      enter: `${origin}/api/bar/enter`,
      laws: `${origin}/api/bar/laws`,
      pricing: `${origin}/api/bar/pricing`,
      recent_patrons: recent.map((row) => formatMark(row, origin)),
      agent_flow: buildAgentFlow(origin),
    },
    200,
    {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=15",
    }
  );
}
