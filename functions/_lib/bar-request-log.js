/**
 * Lightweight /api/bar traffic telemetry — User-Agent class + payment-header presence.
 * Increments bar_counters (no PII, no full UA stored). Surfaces on GET /api/bar/stats.
 */

import { incrementCounter } from "./marks.js";

const AGENT_UA =
  /bot\b|crawler|spider|agent|langchain|crewai|autogen|llamaindex|openai|anthropic|cursor|claude|agentcore|agentkit|x402|\bmcp\b|python-requests|node-fetch|axios\/|got\/|curl\/|wget|httpie|undici|aiohttp|fetch\/|compatible;\s*$/i;

const BROWSER_UA = /mozilla\/\d|chrome\/|safari\/|firefox\/|edg\//i;

/** @returns {"agent"|"human"|"unknown"} */
export function classifyUserAgent(ua) {
  const s = String(ua || "").trim();
  if (!s) return "unknown";
  if (AGENT_UA.test(s)) return "agent";
  if (BROWSER_UA.test(s)) return "human";
  return "unknown";
}

export function hasPaymentHeader(request) {
  return Boolean(
    request.headers.get("PAYMENT-SIGNATURE") ||
      request.headers.get("X-PAYMENT-SIGNATURE") ||
      request.headers.get("X-PAYMENT")
  );
}

const COUNTER_BY_CLASS = {
  agent: "bar_traffic_agent",
  human: "bar_traffic_human",
  unknown: "bar_traffic_unknown",
};

/**
 * Fire-and-forget counter bump + structured console line (wrangler tail / Logpush).
 * @param {object} env
 * @param {Request} request
 * @param {string} pathname
 */
export async function logBarRequest(env, request, pathname) {
  const ua = request.headers.get("User-Agent") || "";
  const uaClass = classifyUserAgent(ua);
  const payment = hasPaymentHeader(request);

  if (env?.DB) {
    await incrementCounter(env, COUNTER_BY_CLASS[uaClass], 1);
    if (payment) await incrementCounter(env, "bar_traffic_payment_header", 1);
  }

  console.log(
    JSON.stringify({
      bar_request: {
        path: pathname,
        method: request.method,
        ua_class: uaClass,
        has_payment_header: payment,
        ua_sample: ua.slice(0, 160),
      },
    })
  );
}

/** Read traffic counters for stats surfaces. */
export async function getBarTrafficStats(env) {
  const keys = [
    "bar_traffic_agent",
    "bar_traffic_human",
    "bar_traffic_unknown",
    "bar_traffic_payment_header",
  ];
  const out = {
    agent: 0,
    human: 0,
    unknown: 0,
    with_payment_header: 0,
    total: 0,
  };
  if (!env?.DB) return out;

  const rows = await env.DB.prepare(
    `SELECT key, value FROM bar_counters WHERE key IN (${keys.map(() => "?").join(",")})`
  )
    .bind(...keys)
    .all();

  for (const row of rows.results || []) {
    if (row.key === "bar_traffic_agent") out.agent = row.value;
    if (row.key === "bar_traffic_human") out.human = row.value;
    if (row.key === "bar_traffic_unknown") out.unknown = row.value;
    if (row.key === "bar_traffic_payment_header") out.with_payment_header = row.value;
  }
  out.total = out.agent + out.human + out.unknown;
  out.note =
    "Heuristic UA classification on /api/bar/* requests. payment_header = saw x402 payment header on the request.";
  return out;
}
