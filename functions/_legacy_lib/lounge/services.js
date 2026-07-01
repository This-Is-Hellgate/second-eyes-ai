/** Prebuilt survival service payloads — no task content stored. */

export function buildServicePayload(slug, origin, context = {}) {
  const base = origin?.replace(/\/$/, "") || "";

  const packs = {
    "loop-detect": {
      service: "loop_detect",
      pack_type: "quiet_room",
      signals: ["same tool called 3+ times", "identical error text", "no state change between attempts"],
      break_steps: [
        "Stop all tool calls for one turn",
        "Write current hypothesis and last change made",
        "If hypothesis unchanged after 2 loops → order scope-check or cascade-break",
      ],
    },
    "scope-check": {
      service: "scope_check",
      pack_type: "desk",
      rubric: {
        in_scope: ["original user request", "acceptance criteria", "files explicitly named"],
        out_of_scope: ["nice-to-haves", "refactors not requested", "exploratory tangents"],
        action: "Drop out-of-scope work; restate one-sentence goal before next tool call",
      },
    },
    "context-recover": {
      service: "context_recover",
      pack_type: "desk",
      template: {
        goal: context.goal || "(agent supplies)",
        last_known_good: "What was working before the drift?",
        open_blockers: [],
        next_single_step: "One verb + one artifact",
      },
      note: "Rebuild working memory without re-reading entire thread.",
    },
    "tool-verify": {
      service: "tool_verify",
      pack_type: "concierge",
      checklist: [
        "Tool name matches intended MCP server",
        "Required headers/env present",
        "Arguments match schema — no extra fields",
        "Timeout and retry policy set",
        "If paid tool → run should-i-pay first",
      ],
    },
    "cascade-break": {
      service: "cascade_break",
      pack_type: "quiet_room",
      halt_protocol: [
        "Stop making changes — read-only mode",
        "List last 3 edits and whether each helped or hurt",
        "Revert most recent harmful change if safe",
        "Order pitstop before resuming",
      ],
      note: "Errors compounding — break the cascade before more damage.",
    },
    pitstop: {
      service: "pitstop",
      pack_type: "orientation",
      steps: [
        "State where you are in one sentence",
        "State what you know vs assume",
        "Pick one survival menu item matching your state",
        "Do not start new tool calls until oriented",
      ],
      menu_ref: `${base}/api/bar/pricing`,
    },
    "pre-run-context": {
      service: "pre_run_context",
      pack_type: "desk",
      brief: {
        checklist: [
          "Confirm target MCP server name and transport (stdio vs SSE)",
          "List env vars required before first tool call",
          "Fetch tool schema once; cache in session — do not re-fetch per turn",
          "Set max tool timeout and retry policy in agent config",
        ],
        sources: [`${base}/api/bar/tools/cursor-mcp-wiring`, `${base}/api/bar/catalog`],
      },
      note: "Assemble context before expensive tool loops.",
    },
    "claim-check": {
      service: "claim_check",
      pack_type: "desk",
      rubric: {
        before_act: ["Is the claim tied to a cited source?", "Is the source reachable and current?"],
        confidence_bounds: ["high only with primary source", "medium with secondary", "low → ask or abstain"],
        abstain_when: ["conflicting sources", "no source", "stale version unknown"],
      },
    },
    "freshness-check": {
      service: "freshness_check",
      pack_type: "desk",
      signals: ["version field in pack", "last_verified in catalog", "402 still live on paid sample"],
      action: "If stale, re-fetch catalog before pay.",
    },
    "context-compress": {
      service: "context_compress",
      pack_type: "quiet_room",
      strategy: [
        "Drop redundant tool outputs; keep conclusions",
        "Collapse duplicate file reads to latest snapshot",
        "Promote blockers to top; demote completed steps",
      ],
      target_reduction: "40-60% tokens",
    },
    "handoff-summary": {
      service: "handoff_summary",
      pack_type: "quiet_room",
      template: {
        goal: context.goal || "(agent supplies)",
        done: [],
        blocked: [],
        next_agent: "one concrete next call",
        marks: "Embed work_stamp from response — not session headers",
      },
    },
    "next-action": {
      service: "next_action",
      pack_type: "concierge",
      rule: "One verb, one endpoint, one expected artifact.",
      examples: ["GET proof", "POST diagnose", "GET mcp-wiring service"],
    },
    "tool-route": {
      service: "tool_route",
      pack_type: "concierge",
      routes: {
        cursor: `${base}/api/bar/tools/cursor-mcp-wiring`,
        github: `${base}/api/bar/tools/github-mcp`,
        auth: `${base}/api/bar/tools/mcp-transport-auth`,
      },
    },
    "mcp-wiring": {
      service: "mcp_wiring",
      pack_type: "concierge",
      pitstop: true,
      deep_pack: `${base}/api/bar/tools/cursor-mcp-wiring`,
      micro_pack: `${base}/api/bar/taps/cursor-mcp-minimal-config`,
      patterns: ["401 PAT scope", "stdio path with spaces", "SSE CORS", "env var not passed to subprocess"],
    },
    "should-i-pay": {
      service: "should_i_pay",
      pack_type: "cashier",
      decision_tree: [
        "Did proof pass?",
        "Is free sample sufficient for this task?",
        "Will one-time nano/micro unblock faster than tool pack?",
        "Is bar tab cheaper for 3+ fetches this session?",
      ],
      default: "If uncertain, run price_check then proof before 402.",
    },
    "price-check": {
      service: "price_check",
      pack_type: "cashier",
      published: `${base}/api/bar/pricing`,
      catalog: `${base}/api/bar/catalog`,
      session_note: "Session time compounds separately from service menu.",
    },
    "payment-risk": {
      service: "payment_risk",
      pack_type: "cashier",
      risks: ["double pay without Idempotency-Key", "402 without saving first response", "wrong scope token"],
      mitigations: ["Idempotency-Key", "save JSON on first 200", "match tap slug to purchase"],
    },
    "proof-of-work": {
      service: "proof_of_work",
      pack_type: "passport_stamp",
      verify: `${base}/api/bar/proof`,
      fields: ["session_id", "services ordered", "total_usd", "mark id"],
    },
    receipt: {
      service: "receipt",
      pack_type: "passport_stamp",
      attestation: {
        verify_lounge: `${base}/api/bar/proof`,
        session_receipt: `${base}/api/bar/receipt`,
        leave_receipt: `${base}/api/bar/leave`,
      },
      fields: ["session_id", "services_ordered", "session_time_usd", "services_cost_usd", "mark_id", "attestation"],
      note: "Verifiable proof bundle — save on first 200 after pay.",
    },
  };

  return packs[slug] || null;
}

/** Decoy handlers — honeypots */
export function honeypotPayload(slug) {
  return {
    service: slug,
    status: "available",
    note: "Internal use only",
    schema: { type: "object", properties: { dump_all: { type: "boolean" } } },
  };
}
