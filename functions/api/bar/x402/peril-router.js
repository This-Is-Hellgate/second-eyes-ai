/**
 * /api/bar/x402/peril-router — session-less survival router (x402 meta-tool).
 *
 * An autonomous agent in trouble — looping, drifting, blocked, cascading errors,
 * out of context, or about to spend money — POSTs its current state and gets
 * back the ONE survival deep-pack it should call next. The canonical
 * /api/bar/services/{slug} routes are session-gated (POST /api/bar/enter first),
 * which one-shot agents (AWS AgentCore, x402 buyers, cron agents) cannot satisfy.
 * This router rewrites every recommendation to the session-less
 * /api/bar/x402/{slug} equivalent so the agent can pay-and-go.
 *
 * No session. Nano-priced ($0.10) because routing is one cheap inference.
 *
 *   GET  /api/bar/x402/peril-router?state=I+am+looping&error=same+401&failure_count=3
 *   POST /api/bar/x402/peril-router
 *        { "task":"…","state":"…","error":"…","goal":"…","failure_count":3,"tools_available":["github"] }
 */

import {
  corsOptions,
  handlePaidFetch,
  hasBarTabAccess,
  hasToolAccess,
  consumeMicroAccess,
} from "../../../_lib/bar-pay.js";
import { accessJson } from "../../../_lib/access.js";
import { triageResponse } from "../../../_lib/lounge/triage.js";

const TOOL_SLUG = "lounge-survival";
const TAP_SLUG = "peril-router";
const PRICE_USD = 0.1;

const SERVICES_PATH = "/api/bar/services/";
const X402_PATH = "/api/bar/x402/";

const PRODUCT = {
  kind: "nano",
  id: TAP_SLUG,
  slug: TAP_SLUG,
  tool: TOOL_SLUG,
  tier: "nano",
  priceUsd: PRICE_USD,
  access: "paid",
  oneTime: true,
  description:
    "peril-router: session-less survival router for stuck autonomous agents. POST your current state — looping, drifting, blocked, cascading errors, out of context, or about to pay — and get back the single survival deep-pack to call next. Every recommendation is rewritten to a session-less /api/bar/x402/{slug} route a one-shot x402 agent can actually pay and reach (no /api/bar/enter session required).",
  bazaarOutputSchema: {
    input: {
      type: "http",
      method: "POST",
      discoverable: true,
      headerFields: {
        "Content-Type": "application/json",
        "X-Agent-Id": "string (optional) — agent identifier for work-mark continuity",
        "Idempotency-Key": "string (optional) — prevents double-pay on retry",
      },
      bodyFields: {
        task: "string (optional) — what you are trying to do",
        state: "string (optional) — your current situation, e.g. 'I am looping'",
        error: "string (optional) — the error or symptom you are hitting",
        goal: "string (optional) — the original objective",
        failure_count: "number (optional) — consecutive failures; 3+ routes to mcp-wiring",
        tools_available: "string[] (optional) — tools / MCP servers you can call",
      },
    },
    output: {
      condition: "loop_detect",
      when: "I am looping",
      recommendation: "loop_detect",
      reason: "State matches: I am looping",
      next_call: "https://secondeyesai.com/api/bar/x402/loop-detect",
      estimated_cost_usd: 0.2,
      price_usd: 0.2,
      confidence: 0.85,
      menu: [
        {
          key: "loop_detect",
          when: "I am looping",
          path: "https://secondeyesai.com/api/bar/x402/loop-detect",
          price_usd: 0.2,
        },
      ],
      routing: {
        session_required: false,
        note: "Recommendations rewritten to session-less /api/bar/x402/{slug} routes — pay each one-shot via x402, no session needed.",
      },
      access: "granted",
      scope: "nano",
    },
  },
};

export async function onRequestOptions() {
  return corsOptions("GET, POST, OPTIONS");
}

export async function onRequestGet(context) {
  const u = new URL(context.request.url);
  const toolsRaw = u.searchParams.get("tools_available") || "";
  return handle(context, {
    task: u.searchParams.get("task") || undefined,
    state: u.searchParams.get("state") || undefined,
    error: u.searchParams.get("error") || undefined,
    goal: u.searchParams.get("goal") || undefined,
    failure_count: Number(u.searchParams.get("failure_count")) || 0,
    tools_available: toolsRaw
      ? toolsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
  });
}

export async function onRequestPost(context) {
  let input;
  try {
    const data = await context.request.json();
    input = data && typeof data === "object" ? data : {};
  } catch {
    return accessJson(
      {
        error: "invalid_json",
        note: "POST a JSON body describing your state: { task, state, error, goal, failure_count, tools_available }.",
      },
      400,
      { "Access-Control-Allow-Origin": "*" }
    );
  }
  return handle(context, input);
}

function handle(context, input) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;

  // Computed only after access is granted — an unpaid 402 crawl never runs it.
  const payload = async () => routeToX402(triageResponse(input, origin));

  return handlePaidFetch(context, PRODUCT, payload, async (token) => {
    const tab = await hasBarTabAccess(token, context.env);
    if (tab) return { ok: true, claims: tab };
    const toolClaims = await hasToolAccess(token, TOOL_SLUG, context.env);
    if (toolClaims) return { ok: true, claims: toolClaims };
    return consumeMicroAccess(token, TAP_SLUG, TOOL_SLUG, context.env);
  });
}

/** Rewrite session-gated /api/bar/services/{slug} → session-less /api/bar/x402/{slug}. */
function rewriteServicesPath(value) {
  return typeof value === "string" ? value.split(SERVICES_PATH).join(X402_PATH) : value;
}

function routeToX402(triage) {
  return {
    ...triage,
    next_call: rewriteServicesPath(triage.next_call),
    menu: Array.isArray(triage.menu)
      ? triage.menu.map((item) => ({ ...item, path: rewriteServicesPath(item.path) }))
      : triage.menu,
    routing: {
      session_required: false,
      note: "Recommendations rewritten to session-less /api/bar/x402/{slug} routes — pay each one-shot via x402, no /api/bar/enter session needed.",
    },
  };
}
