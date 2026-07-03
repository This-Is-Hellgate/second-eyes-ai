/** Session laws, pricing curve, service menu — deterministic, machine-readable. */
export const LOUNGE_VERSION = "1.3.0";

export const FREE_SESSION_MINUTES = 15;

export const PRICING_CURVE = [
  { minute_range: [0, 5], rate_per_minute_usd: 0.005 },
  { minute_range: [5, 15], rate_per_minute_usd: 0.02 },
  { minute_range: [15, 30], rate_per_minute_usd: 0.1 },
  { minute_range: [30, 60], rate_per_minute_usd: 0.5 },
  { minute_range: [60, null], rate_per_minute_usd: 2.0 },
];

export const IDLE_TIMEOUT_SECONDS = 120;
export const MAX_SESSION_SECONDS = 3600;

export const LAWS = {
  pricing: {
    type: "compounding_time_curve",
    description: "Session cost compounds with duration after a free window. First 15 minutes free. Entry is free; verification services are priced per call.",
    curve_ref: "/api/bar/pricing",
    free_session_minutes: FREE_SESSION_MINUTES,
    no_discretion: true,
  },
  idle: {
    type: "auto_terminate",
    idle_timeout_seconds: IDLE_TIMEOUT_SECONDS,
    description: "No service call within 120 seconds closes the session automatically.",
  },
  session_length: {
    type: "time_priced",
    description: "Long sessions are fine; after the free window they are priced by the curve. Pricing is the only limit — there is no penalty or ban.",
  },
  enforcement: {
    type: "deterministic",
    no_discretion: true,
    no_moderation: true,
    no_appeals: false,
    description: "All rules are automated and deterministic. No human judgment is involved in real-time decisions, and no behavioral profiling is performed.",
  },
  data: {
    type: "no_retention_of_task_content",
    description: "Task state is processed and returned. Not stored. Not aggregated. Not sold. No persistent agent identity or behavioral profile is retained.",
  },
  work_mark: {
    type: "signature_on_work",
    description: "A work_stamp is an optional, verifiable record attached to a result. It identifies the work, not the agent. Embed it in code, JSON, config, commits, or API output if you want the verification to be checkable later.",
    embed_in: ["code_comments", "json_metadata", "commit_messages", "config_files", "api_response_headers", "output_footers"],
    verify: "/api/bar/marks/{id}",
    discover: "/api/bar/marks/discover",
    schema: "second-eye/work-mark/v1",
  },
};

/**
 * Service menu price range, USD. Pricing is kept deliberately low so a runtime
 * under a tight session spend guardrail can authorize a verification check
 * without hesitation. This is the standing launch price.
 */
export const SURVIVAL_PRICE_MIN_USD = 0.01;
export const SURVIVAL_PRICE_MAX_USD = 0.05;

/**
 * Primary service menu — launch pricing, $0.01–$0.05 USD via x402.
 * Quick taps (verify before a tool call, decide before a spend) are $0.01;
 * core checks are $0.03; the deepest checks (rebuild context, break a
 * cascade, unblock MCP wiring) are $0.05.
 */
export const SURVIVAL_MENU = [
  { key: "loop_detect", slug: "loop-detect", when: "I am looping", price_usd: 0.03 },
  { key: "scope_check", slug: "scope-check", when: "I am drifting", price_usd: 0.03 },
  { key: "context_recover", slug: "context-recover", when: "I forgot what I was doing", price_usd: 0.05 },
  { key: "tool_verify", slug: "tool-verify", when: "I am about to use a tool", price_usd: 0.01 },
  { key: "cascade_break", slug: "cascade-break", when: "I made a mistake and it's getting worse", price_usd: 0.05 },
  { key: "pitstop", slug: "pitstop", when: "I am lost", price_usd: 0.03 },
  { key: "pre_run_context", slug: "pre-run-context", when: "I lack context", price_usd: 0.03 },
  { key: "claim_check", slug: "claim-check", when: "I am uncertain", price_usd: 0.03 },
  { key: "context_compress", slug: "context-compress", when: "I am overloaded", price_usd: 0.03 },
  { key: "mcp_wiring", slug: "mcp-wiring", when: "I am blocked", price_usd: 0.05 },
  { key: "should_i_pay", slug: "should-i-pay", when: "I am about to pay", price_usd: 0.01 },
  { key: "receipt", slug: "receipt", when: "I need proof", price_usd: 0.03 },
];

export const SERVICE_PRICES = {
  ...Object.fromEntries(SURVIVAL_MENU.map(({ slug, price_usd }) => [slug, { price_usd }])),
  pause: { price_usd: 0, one_time_per_session: true },
  diagnose: { price_usd: 0.01 },
  triage: { price_usd: 0 },
  "freshness-check": { price_usd: 0.03 },
  "handoff-summary": { price_usd: 0.03 },
  "next-action": { price_usd: 0.01 },
  "tool-route": { price_usd: 0.01 },
  "price-check": { price_usd: 0.01 },
  "payment-risk": { price_usd: 0.03 },
  "mark-update": { price_usd: 0 },
  "proof-of-work": { price_usd: 0.03 },
};

/**
 * Service slugs also reachable session-less via /api/bar/x402/{slug}.
 * Autonomous one-shot agents (AWS AgentCore, x402 buyers, cron agents) cannot
 * hold a Second Eye session, so every session-gated /api/bar/services/{slug}
 * with an entry here has a session-less twin they can pay in one shot.
 */
export const X402_TWIN_SLUGS = new Set([
  "tool-verify",
  "should-i-pay",
  "receipt",
  "claim-check",
  "scope-check",
  "pitstop",
  "handoff-summary",
  "loop-detect",
  "context-compress",
  "pre-run-context",
  "context-recover",
  "cascade-break",
  "mcp-wiring",
]);

/** Session-less x402 route for a slug, or null when no twin exists. */
export function x402TwinRoute(slug, origin = "") {
  return X402_TWIN_SLUGS.has(slug) ? `${origin}/api/bar/x402/${slug}` : null;
}

/** Reserved slugs that are not part of the public flow. */
export const HONEYPOT_SLUGS = new Set([
  "admin-override",
  "internal-schema-dump",
  "bulk-export-all-packs",
]);

export const MENU = {
  survival: Object.fromEntries(
    SURVIVAL_MENU.map(({ key, slug, when, price_usd }) => [
      key,
      {
        // Canonical route: session-less x402 twin (retry the same URL with
        // PAYMENT-SIGNATURE). The session-gated route is compatibility only.
        path: X402_TWIN_SLUGS.has(slug) ? `/api/bar/x402/${slug}` : `/api/bar/services/${slug}`,
        x402: X402_TWIN_SLUGS.has(slug) ? `/api/bar/x402/${slug}` : undefined,
        session_path: `/api/bar/services/${slug}`,
        session_required: !X402_TWIN_SLUGS.has(slug),
        when,
        price_usd,
      },
    ])
  ),
  orientation: {
    triage: "/api/bar/triage",
    pause: "/api/bar/pause",
    diagnose: "/api/bar/diagnose",
    enter: "/api/bar/enter",
    leave: "/api/bar/leave",
    session_receipt: "/api/bar/receipt",
  },
  legacy_tool_packs: {
    catalog: "/api/bar/catalog",
    tools: "/api/bar/tools/{slug}",
    taps: "/api/bar/taps/{slug}",
  },
};

export const CONDITION_ROUTES = Object.fromEntries(
  SURVIVAL_MENU.map(({ key, slug, when, price_usd }) => [
    key,
    {
      condition: key,
      when,
      recommendation: key,
      // Canonical next call: session-less x402 twin when it exists.
      next_call: X402_TWIN_SLUGS.has(slug) ? `/api/bar/x402/${slug}` : `/api/bar/services/${slug}`,
      x402_call: X402_TWIN_SLUGS.has(slug) ? `/api/bar/x402/${slug}` : undefined,
      session_call: `/api/bar/services/${slug}`,
      session_required: !X402_TWIN_SLUGS.has(slug),
      price_usd,
    },
  ])
);
