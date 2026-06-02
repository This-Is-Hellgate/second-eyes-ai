/**
 * /api/bar/x402/context-pressure — deep single-concern meta-tool (session-less x402).
 *
 * The door an autonomous agent calls when it is running out of context/token
 * budget and needs one deterministic verdict before the next expensive move:
 * keep working, compact proactively, stop-and-compact, or stop-and-reconstruct.
 *
 * help-me classifies "I am overloaded / near the limit" and routes here; this
 * door turns the agent's remaining_context / token figures into a fixed band
 * with deterministic thresholds, so the verdict is identical on every call near
 * the edge of the window (an agent cannot afford a flaky answer here). Returns
 * stop / preserve / continue guidance, the pressure_band, an escalate_if
 * boundary, and a recommended next_call (context-compress or context-recover).
 *
 * No session. Launch recovery price ($0.03) — a core recovery pack, one cheap
 * deterministic verdict, low enough to clear a tight session spend guardrail.
 *
 *   GET  /api/bar/x402/context-pressure?remaining_context=12%
 *   GET  /api/bar/x402/context-pressure?tokens_used=185000&token_budget=200000
 *   POST /api/bar/x402/context-pressure
 *        { "remaining_context":"8%", "state":"…", "goal":"…" }
 *
 * token-pressure is accepted as a body/param alias for the same concern.
 */

import {
  corsOptions,
  readOptionalJsonBody,
  handlePaidFetch,
  hasBarTabAccess,
  hasToolAccess,
  consumeMicroAccess,
} from "../../../_lib/bar-pay.js";
import { accessJson } from "../../../_lib/access.js";
import { diagnoseContext } from "../../../_lib/lounge/meta-tools.js";

const TOOL_SLUG = "lounge-survival";
const TAP_SLUG = "context-pressure";
const PRICE_USD = 0.03;

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
    "context-pressure (session-less x402, also: token-pressure): you are running out of context/token budget. Send remaining_context (e.g. '12%') or tokens_used + token_budget and get a deterministic verdict — continue / preserve / stop — keyed to a fixed pressure_band (headroom <70% used, compact_proactively 70–85%, stop_and_compact 85–95%, critical >95%). Returns stop/preserve/continue guidance, the band, an escalate_if boundary, and a recommended next_call (context-compress to free room, context-recover to reconstruct via handoff). Same usage figure, same verdict every time — safe to trust at the edge of the window. Pay once with PAYMENT-SIGNATURE, no /api/bar/enter session.",
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
        remaining_context: "string|number (optional) — fraction/percent of budget LEFT, e.g. '12%' or 0.12",
        tokens_used: "number (optional) — tokens consumed (pair with token_budget)",
        token_budget: "number (optional) — total token budget",
        used_fraction: "number (optional) — fraction of budget USED, 0–1",
        state: "string (optional) — extra context",
        goal: "string (optional) — the original objective",
      },
    },
    output: {
      tool: TAP_SLUG,
      used_fraction: 0.92,
      pressure_band: "stop_and_compact",
      verdict: "stop",
      stop: "Stop before the next expensive tool call — compact first or it may not fit.",
      preserve: "Keep open blockers and the goal; drop duplicate tool output and re-reads.",
      continue: "Compact now (drop redundant context), then resume the single next step.",
      escalate_if: "compaction frees < 10% — switch to reconstruct via handoff.",
      next_call: "https://secondeyesai.com/api/bar/x402/context-compress",
      confidence: 0.9,
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
  return handle(context, {
    remaining_context: u.searchParams.get("remaining_context") ?? u.searchParams.get("remaining") ?? undefined,
    tokens_used: u.searchParams.get("tokens_used") ?? undefined,
    token_budget: u.searchParams.get("token_budget") ?? undefined,
    used_fraction: u.searchParams.get("used_fraction") ?? u.searchParams.get("context_used") ?? undefined,
    state: u.searchParams.get("state") || undefined,
    goal: u.searchParams.get("goal") || undefined,
  });
}

export async function onRequestPost(context) {
  // Every field is optional, so an empty/blank body is a valid bare probe and must
  // reach the x402 paywall (402); only a non-empty malformed body is 400.
  const parsed = await readOptionalJsonBody(context.request);
  if (!parsed.ok) {
    return accessJson(
      {
        error: "invalid_json",
        note: "POST a JSON body: { remaining_context, tokens_used, token_budget, used_fraction, state, goal }. All fields optional.",
      },
      400,
      { "Access-Control-Allow-Origin": "*" }
    );
  }
  return handle(context, parsed.data);
}

function handle(context, input) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;

  // Computed only after access is granted — an unpaid 402 crawl never runs it.
  const payload = async () => withNextCall(diagnoseContext(input), origin);

  return handlePaidFetch(context, PRODUCT, payload, async (token) => {
    const tab = await hasBarTabAccess(token, context.env);
    if (tab) return { ok: true, claims: tab };
    const toolClaims = await hasToolAccess(token, TOOL_SLUG, context.env);
    if (toolClaims) return { ok: true, claims: toolClaims };
    return consumeMicroAccess(token, TAP_SLUG, TOOL_SLUG, context.env);
  });
}

/** Absolutize any relative next_call to the request origin so a one-shot agent can call it directly. */
function withNextCall(result, origin) {
  if (result.next_call && result.next_call.startsWith("/")) {
    return { ...result, next_call: `${origin}${result.next_call}` };
  }
  return result;
}
