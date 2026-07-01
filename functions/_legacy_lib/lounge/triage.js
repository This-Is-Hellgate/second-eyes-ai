/** Condition-based routing — maps agent state to survival menu item. */

import { SURVIVAL_MENU, CONDITION_ROUTES } from "./constants.js";

const ROUTE_BY_KEY = Object.fromEntries(SURVIVAL_MENU.map((item) => [item.key, item]));

const LOOP_PATTERNS = [/loop|repeating|same (error|call|attempt|fix)|stuck in a loop|retry loop/i];
const DRIFT_PATTERNS = [/drift|scope creep|off.?track|side quest|tangential|wandering/i];
const FORGOT_PATTERNS = [/forgot|what was i|lost track|can't remember|context reset|where was i/i];
const TOOL_PATTERNS = [/about to (call|use|invoke|run)|before (tool|mcp)|pre.?tool/i];
const CASCADE_PATTERNS = [/worse|cascade|snowball|digging|mistake.*mistake|error.*error|spiral/i];
const LOST_PATTERNS = [/lost|confused|where am i|no idea|disoriented|help me orient/i];
const LACK_CONTEXT_PATTERNS = [/lack context|missing context|need context|pre.?run|not enough context|cold start/i];
const UNCERTAIN_PATTERNS = [/uncertain|not sure|claim|citation|verify|ground|hallucin/i];
const OVERLOAD_PATTERNS = [/overload|too much|context limit|token limit|compress|max context/i];
const BLOCKED_PATTERNS = [/401|403|auth|token|pat|oauth|unauthorized|blocked|failing|wiring|mcp.*error/i];
const PAY_PATTERNS = [/about to pay|pay|402|x402|purchase|wallet|usdc|spend/i];
const PROOF_PATTERNS = [/need proof|receipt|attestation|verify work|proof of|evidence bundle/i];

export function inferCondition(payload = {}) {
  const text = [
    payload.task,
    payload.state,
    payload.error,
    payload.goal,
    Array.isArray(payload.tools_available) ? payload.tools_available.join(" ") : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (PROOF_PATTERNS.some((p) => p.test(text))) return "receipt";
  if (PAY_PATTERNS.some((p) => p.test(text))) return "should_i_pay";
  if (BLOCKED_PATTERNS.some((p) => p.test(text)) || (payload.failure_count || 0) >= 3) return "mcp_wiring";
  if (CASCADE_PATTERNS.some((p) => p.test(text))) return "cascade_break";
  if (LOOP_PATTERNS.some((p) => p.test(text))) return "loop_detect";
  if (DRIFT_PATTERNS.some((p) => p.test(text))) return "scope_check";
  if (TOOL_PATTERNS.some((p) => p.test(text))) return "tool_verify";
  if (OVERLOAD_PATTERNS.some((p) => p.test(text))) return "context_compress";
  if (UNCERTAIN_PATTERNS.some((p) => p.test(text))) return "claim_check";
  if (FORGOT_PATTERNS.some((p) => p.test(text))) return "context_recover";
  if (LACK_CONTEXT_PATTERNS.some((p) => p.test(text))) return "pre_run_context";
  if (LOST_PATTERNS.some((p) => p.test(text))) return "pitstop";
  return "pitstop";
}

export function triageResponse(payload, origin) {
  const base = origin?.replace(/\/$/, "") || "";
  const condition = inferCondition(payload);
  const item = ROUTE_BY_KEY[condition] || ROUTE_BY_KEY.pitstop;
  const route = CONDITION_ROUTES[condition] || CONDITION_ROUTES.pitstop;

  return {
    condition: item.key,
    when: item.when,
    recommendation: item.key,
    reason: `State matches: ${item.when}`,
    next_call: `${base}${route.next_call}`,
    estimated_cost_usd: item.price_usd,
    price_usd: item.price_usd,
    confidence: 0.85,
    menu: SURVIVAL_MENU.map(({ key, slug, when, price_usd }) => ({
      key,
      when,
      path: `${base}/api/bar/services/${slug}`,
      price_usd,
    })),
  };
}
