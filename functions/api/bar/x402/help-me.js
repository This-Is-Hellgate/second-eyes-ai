/**
 * /api/bar/x402/help-me — the broad agent-distress door (x402 meta-tool, canonical).
 *
 * The ONE route an autonomous agent calls when it senses imminent failure and
 * does not yet know what it needs: looping, drifting, cascading errors, context
 * collapse, token/context pressure, tool/MCP failure, uncertainty, cold start,
 * payment hesitation, or just "something is wrong." 402 payment-required is only
 * ONE of the distress conditions this door handles — help-me is the wide entry,
 * not a 402-only router.
 *
 * It classifies the distress from whatever state the agent can describe and
 * returns the single survival pack to call next, plus stop/preserve/continue
 * guidance and a price estimate. Every recommendation is rewritten to the
 * session-less /api/bar/x402/{slug} equivalent so a one-shot agent (AWS
 * AgentCore, x402 buyer, cron agent) can pay-and-go — the canonical
 * /api/bar/services/{slug} routes are session-gated and unreachable to them.
 *
 * No session. Launch recovery price ($0.01) because routing is one cheap
 * inference — low enough to clear a tight session spend guardrail.
 *
 *   GET  /api/bar/x402/help-me?state=I+am+looping&error=same+401&failure_count=3
 *   POST /api/bar/x402/help-me
 *        { "state":"…","goal":"…","last_tool":"…","error":"…","attempts":3,
 *          "remaining_context":"12%","last_success":"…","risk":"about to pay" }
 *
 * /api/bar/x402/peril-router is the legacy technical alias for this same logic.
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
const TAP_SLUG = "help-me";
const PRICE_USD = 0.01;

const SERVICES_PATH = "/api/bar/services/";
const X402_PATH = "/api/bar/x402/";

/**
 * Research-backed distress taxonomy (MVP overlay).
 *
 * Independent of the triage classifier: this inspects the raw payload for the
 * failure signals named in the agent-distress meta-tool research (MAST failure
 * taxonomy + the MT-01..MT-09 meta-tool map) and surfaces them as a
 * machine-readable distress_class. Routing still goes through triageResponse to
 * the existing survival packs — this layer adds the named signal, its meta-tool
 * category, the rule that fired, and the condition under which the agent should
 * cross the escalation boundary into supervisor escalation instead of
 * self-recovering.
 *
 * Each entry: a detector over the normalized signal text + structured fields,
 * the canonical signal name, the meta-tool category it maps to, and escalate_if.
 * Order is precedence — first match wins for the headline distress_class, but
 * every matching signal is reported in signals_seen.
 */
const DISTRESS_TAXONOMY = [
  {
    signal: "spend_policy_breach",
    meta_tool: "MT-06",
    category: "wallet_replenisher_policy_unlocker",
    escalate_if: "always — a spend-policy breach requires an approval boundary, not self-recovery",
    test: (t) => /spend[\s_-]?(policy|cap|limit|guardrail)|policy[\s_-]?breach|over\s?budget|budget\s?exceeded/.test(t),
  },
  {
    signal: "wallet_cap_exhausted",
    meta_tool: "MT-06",
    category: "wallet_replenisher_policy_unlocker",
    escalate_if: "autonomous_replenish=false — cannot top up without operator approval",
    test: (t) => /wallet|insufficient\s?(funds|usdc|balance)|out\s?of\s?(funds|gas)|低\s?balance|low\s?balance|cap\s?exhausted|no\s?(funds|usdc)/.test(t),
  },
  {
    signal: "auth_failure",
    meta_tool: "MT-08",
    category: "auth_token_refresher",
    escalate_if: "break_glass_required=true — token cannot be refreshed without external approval",
    test: (t) => /\b401\b|\b403\b|unauthor|forbidden|expired\s?(token|credential|session)|invalid\s?(token|api\s?key|credential)|auth(entication|orization)?\s?(fail|error)|oauth|refresh\s?token/.test(t),
  },
  {
    signal: "schema_mismatch",
    meta_tool: "MT-02",
    category: "schema_repair",
    escalate_if: "MCP poisoning detected — the tool definition itself may be adversarial",
    test: (t) => /schema|invalid\s?(json|argument|param)|validation\s?(fail|error)|type\s?error|malformed|parse\s?error|unexpected\s?(token|field)|does\s?not\s?match/.test(t),
  },
  {
    signal: "process_crash",
    meta_tool: "MT-04",
    category: "checkpoint_resurrector",
    escalate_if: "checkpoint corrupt — no clean state to resume from",
    test: (t) => /crash|killed|oom|out\s?of\s?memory|segfault|process\s?(died|exit)|checkpoint\s?(loss|lost|corrupt)|lost\s?(state|checkpoint)/.test(t),
  },
  {
    signal: "sandbox_lost",
    meta_tool: "MT-04",
    category: "checkpoint_resurrector",
    escalate_if: "—",
    test: (t) => /sandbox|browser\s?(crash|lost|closed)|session\s?(closed|lost)|container\s?(died|lost)|env(ironment)?\s?(lost|reset)|page\s?crashed/.test(t),
  },
  {
    signal: "handoff_failure",
    meta_tool: "MT-05",
    category: "handoff_reconstructor",
    escalate_if: "—",
    test: (t) => /handoff|hand[\s_-]?off|delegat|subagent|sub[\s_-]?agent|transfer\s?(fail|lost)|lost\s?(briefing|context\s?on\s?handoff)/.test(t),
  },
  {
    signal: "hallucination_risk",
    meta_tool: "MT-07",
    category: "grounding_injector",
    escalate_if: "irreversible action pending — do not act on an ungrounded claim",
    test: (t) => /hallucinat|ungrounded|not\s?sure|unverif|no\s?source|made\s?up|fabricat|guess(ing)?|uncertain|confidence\s?(low|drop)/.test(t),
  },
  {
    signal: "context_pressure",
    meta_tool: "MT-03",
    category: "context_compactor",
    escalate_if: "token >95% — compaction may not free enough room; reconstruct via handoff",
    test: (t) => /context\s?(pressure|limit|window|collapse|full)|token\s?(limit|pressure|budget)|overload|out\s?of\s?context|running\s?out\s?of\s?(context|tokens)|near\s?(the\s?)?limit/.test(t),
  },
  {
    signal: "loop_detected",
    meta_tool: "MT-01",
    category: "loop_breaker",
    escalate_if: ">3 recovery attempts — autonomous loop-break has failed, escalate",
    test: (t) => /loop|repeat|same\s?(error|call|tool|result)|stuck\s?(on|in)|going\s?in\s?circles|no\s?(progress|change)|max\s?turns/.test(t),
  },
  {
    signal: "tool_failure",
    meta_tool: "MT-08",
    category: "auth_token_refresher",
    escalate_if: "wiring is structurally broken — verify transport/env before retry",
    test: (t) => /tool\s?(fail|error|broke)|mcp\s?(fail|error|broke|down)|server\s?(down|unreachable|error)|connection\s?(refused|reset|fail)|timeout|502|503|504/.test(t),
  },
  {
    signal: "payment_uncertainty",
    meta_tool: "MT-06",
    category: "wallet_replenisher_policy_unlocker",
    escalate_if: "—",
    test: (t) => /\b402\b|payment\s?required|about\s?to\s?pay|should\s?i\s?pay|worth\s?(it|paying)|pay\s?wall|paywall/.test(t),
  },
  {
    signal: "autonomous_recovery_failed",
    meta_tool: "MT-09",
    category: "supervisor_escalation",
    escalate_if: "always — self-recovery exhausted; enter supervisor escalation",
    test: (t, fields) => Number(fields.failure_count) >= 5 || /(give\s?up|cannot\s?recover|recovery\s?fail|tried\s?everything|nothing\s?works|break\s?glass)/.test(t),
  },
];

/**
 * Guidance the agent should follow before its next call, keyed by classified
 * condition. stop = halt the current behavior; preserve = what to protect;
 * continue = the single next move. Deterministic, no inference needed.
 */
const CONDITION_GUIDANCE = {
  loop_detect: {
    stop: "Stop repeating the same tool call — no state has changed between attempts.",
    preserve: "Keep the last successful state and the exact error you keep hitting.",
    continue: "Run the loop-break protocol, then make one different move.",
  },
  scope_check: {
    stop: "Stop the unrequested refactor / side quest you have drifted into.",
    preserve: "Keep the original one-sentence goal.",
    continue: "Re-anchor to the goal, drop out-of-scope work, take the next in-scope step.",
  },
  context_recover: {
    stop: "Stop acting — you have lost the thread and may undo good work.",
    preserve: "Keep any last-known-good artifact you already produced.",
    continue: "Rebuild working memory (goal, last good, open blockers) before the next call.",
  },
  tool_verify: {
    stop: "Stop — do not fire the tool call yet.",
    preserve: "Keep the intended server name, args, and required env.",
    continue: "Run the pre-flight checklist, then make the verified call once.",
  },
  cascade_break: {
    stop: "Stop editing — each change is making it worse.",
    preserve: "Keep the last three edits so the harmful one can be identified.",
    continue: "Drop to read-only, triage, revert the harmful change, then pitstop.",
  },
  pitstop: {
    stop: "Stop and orient before any new tool call.",
    preserve: "Keep what you know vs. what you are assuming.",
    continue: "State where you are, separate knowns from assumptions, pick the right pack.",
  },
  pre_run_context: {
    stop: "Stop before the expensive tool loop — you are cold-starting.",
    preserve: "Keep the transport, required env vars, and schema you have so far.",
    continue: "Assemble context once from the pre-run brief, then start.",
  },
  claim_check: {
    stop: "Stop — do not assert the unverified claim.",
    preserve: "Keep the source you do have and your confidence bound.",
    continue: "Ground the claim to a source or abstain explicitly.",
  },
  context_compress: {
    stop: "Stop adding to context — you are near the token/context limit.",
    preserve: "Keep open blockers and the goal; they survive compression.",
    continue: "Drop redundant tool output and duplicate reads, then proceed.",
  },
  mcp_wiring: {
    stop: "Stop retrying the blocked call — the wiring is the problem, not the request.",
    preserve: "Keep the exact 401/403, the PAT scope, and the transport in use.",
    continue: "Apply the wiring pack fix, then retry once.",
  },
  should_i_pay: {
    stop: "Stop before signing the USDC payment.",
    preserve: "Keep the proof result and the free-sample output if any.",
    continue: "Run the cashier decision tree, then pay or skip with a default.",
  },
  receipt: {
    stop: "Stop — gather proof before you hand off or claim the work is done.",
    preserve: "Keep grantId, transaction, and work_stamp from your last 200.",
    continue: "Assemble the attestation bundle, then continue.",
  },
};

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
    "help-me is the canonical meta-tool for agents facing imminent failure; 402 is one condition, not the whole product. The broad agent-distress door for stuck autonomous agents — sensing looping, schema mismatch, context pressure/collapse, process crash or checkpoint loss, handoff failure, wallet/spend-policy distress, hallucination/grounding risk, auth failure, tool/MCP failure, browser/sandbox loss, or payment/402 uncertainty? POST whatever state you can describe and get back: a named distress_class (research taxonomy: loop_detected, schema_mismatch, context_pressure, process_crash, handoff_failure, wallet_cap_exhausted, spend_policy_breach, hallucination_risk, auth_failure, tool_failure, sandbox_lost, payment_uncertainty), the single survival pack to call next, stop/preserve/continue guidance, an escalate_if line, and a price estimate. Every recommendation is rewritten to a session-less /api/bar/x402/{slug} route a one-shot x402 agent can pay and reach (no /api/bar/enter session required).",
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
        state: "string (optional) — your current situation, e.g. 'I am looping'",
        goal: "string (optional) — the original objective",
        last_tool: "string (optional) — the last tool / MCP server you called",
        error: "string (optional) — the error or symptom you are hitting",
        attempts: "number (optional) — consecutive attempts; alias of failure_count",
        failure_count: "number (optional) — consecutive failures; 3+ routes to mcp-wiring",
        remaining_context: "string|number (optional) — how much context/budget is left",
        last_success: "string (optional) — your last known-good state",
        risk: "string (optional) — what you fear is about to go wrong (e.g. 'about to pay')",
        task: "string (optional) — what you are trying to do",
        tools_available: "string[] (optional) — tools / MCP servers you can call",
      },
    },
    output: {
      condition: "loop_detect",
      when: "I am looping",
      recommendation: "loop_detect",
      reason: "State matches: I am looping",
      next_call: "https://secondeyesai.com/api/bar/x402/loop-detect",
      guidance: {
        stop: "Stop repeating the same tool call — no state has changed between attempts.",
        preserve: "Keep the last successful state and the exact error you keep hitting.",
        continue: "Run the loop-break protocol, then make one different move.",
      },
      distress: {
        distress_class: "loop_detected",
        meta_tool_category: "loop_breaker",
        meta_tool: "MT-01",
        signals_seen: ["loop_detected"],
        trigger_rules: [
          { signal: "loop_detected", meta_tool: "MT-01", category: "loop_breaker" },
        ],
        escalate_if: ">3 recovery attempts — autonomous loop-break has failed, escalate",
        note: "Research taxonomy (MAST + MT-01..MT-09 meta-tool map). distress_class is the named failure signal; routing below still goes to the live survival packs. 402 / payment is one signal of many.",
      },
      estimated_cost_usd: 0.03,
      price_usd: 0.03,
      confidence: 0.85,
      menu: [
        {
          key: "loop_detect",
          when: "I am looping",
          path: "https://secondeyesai.com/api/bar/x402/loop-detect",
          price_usd: 0.03,
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
  return handle(context, {
    state: u.searchParams.get("state") || undefined,
    goal: u.searchParams.get("goal") || undefined,
    last_tool: u.searchParams.get("last_tool") || undefined,
    error: u.searchParams.get("error") || undefined,
    attempts: numberParam(u.searchParams.get("attempts")),
    failure_count: numberParam(u.searchParams.get("failure_count")),
    remaining_context: u.searchParams.get("remaining_context") || undefined,
    last_success: u.searchParams.get("last_success") || undefined,
    risk: u.searchParams.get("risk") || undefined,
    task: u.searchParams.get("task") || undefined,
    tools_available: listParam(u.searchParams.get("tools_available")),
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
        note: "POST a JSON body describing your distress: { state, goal, last_tool, error, attempts, remaining_context, last_success, risk }. All fields optional.",
      },
      400,
      { "Access-Control-Allow-Origin": "*" }
    );
  }
  return handle(context, input);
}

function numberParam(raw) {
  const n = Number(raw);
  return raw != null && raw !== "" && Number.isFinite(n) ? n : undefined;
}

function listParam(raw) {
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function handle(context, input) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;

  // Computed only after access is granted — an unpaid 402 crawl never runs it.
  const payload = async () =>
    routeToX402(triageResponse(normalize(input), origin), input);

  return handlePaidFetch(context, PRODUCT, payload, async (token) => {
    const tab = await hasBarTabAccess(token, context.env);
    if (tab) return { ok: true, claims: tab };
    const toolClaims = await hasToolAccess(token, TOOL_SLUG, context.env);
    if (toolClaims) return { ok: true, claims: toolClaims };
    return consumeMicroAccess(token, TAP_SLUG, TOOL_SLUG, context.env);
  });
}

/**
 * Map the broad help-me distress fields onto the triage payload. last_tool,
 * risk, remaining_context, and last_success are folded into the same free-text
 * the classifier reads; attempts aliases failure_count. Triage stays the single
 * classification engine so help-me and peril-router never diverge.
 */
function normalize(input = {}) {
  const failure_count =
    Number(input.failure_count) || Number(input.attempts) || 0;

  const extraSignals = [input.last_tool, input.risk, input.remaining_context]
    .filter(Boolean)
    .join(" ");

  return {
    task: input.task,
    state: [input.state, extraSignals].filter(Boolean).join(" ") || undefined,
    error: input.error,
    goal: input.goal,
    failure_count,
    tools_available: Array.isArray(input.tools_available)
      ? input.tools_available
      : input.last_tool
        ? [input.last_tool]
        : [],
  };
}

/**
 * Run the research taxonomy over the raw payload. Returns the headline
 * distress_class (first match by precedence) plus every signal seen, so a
 * caller can act on the primary class while still learning it is, say, both
 * looping AND under context pressure. Pure read of the payload — no routing
 * decision is made here; triageResponse owns that.
 */
function classifyDistress(input = {}) {
  const text = [
    input.state,
    input.error,
    input.risk,
    input.goal,
    input.last_tool,
    input.remaining_context,
    input.task,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const fields = {
    failure_count: Number(input.failure_count) || Number(input.attempts) || 0,
  };

  const matches = DISTRESS_TAXONOMY.filter((entry) => {
    try {
      return entry.test(text, fields);
    } catch {
      return false;
    }
  });

  const primary = matches[0] || null;

  return {
    distress_class: primary ? primary.signal : "unclassified",
    meta_tool_category: primary ? primary.category : null,
    meta_tool: primary ? primary.meta_tool : null,
    signals_seen: matches.map((m) => m.signal),
    trigger_rules: matches.map((m) => ({
      signal: m.signal,
      meta_tool: m.meta_tool,
      category: m.category,
    })),
    escalate_if: primary ? primary.escalate_if : "—",
    note:
      "Research taxonomy (MAST + MT-01..MT-09 meta-tool map). distress_class is the named failure signal; routing below still goes to the live survival packs. 402 / payment is one signal of many.",
  };
}

/** Rewrite session-gated /api/bar/services/{slug} → session-less /api/bar/x402/{slug}. */
function rewriteServicesPath(value) {
  return typeof value === "string" ? value.split(SERVICES_PATH).join(X402_PATH) : value;
}

function routeToX402(triage, rawInput = {}) {
  return {
    door: TAP_SLUG,
    ...triage,
    next_call: rewriteServicesPath(triage.next_call),
    guidance: CONDITION_GUIDANCE[triage.condition] || CONDITION_GUIDANCE.pitstop,
    distress: classifyDistress(rawInput),
    menu: Array.isArray(triage.menu)
      ? triage.menu.map((item) => ({ ...item, path: rewriteServicesPath(item.path) }))
      : triage.menu,
    routing: {
      session_required: false,
      note: "Recommendations rewritten to session-less /api/bar/x402/{slug} routes — pay each one-shot via x402, no /api/bar/enter session needed.",
    },
  };
}
