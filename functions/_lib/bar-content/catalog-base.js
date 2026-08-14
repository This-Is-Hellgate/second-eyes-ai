/** Second Eye Agent Lounge — machine registry + legacy MCP packs. */

import { buildAgentFlow } from "../agent-entry.js";
import { MENU, LOUNGE_VERSION, SERVICE_PRICES, PRICING_CURVE, IDLE_TIMEOUT_SECONDS, MAX_SESSION_SECONDS, FREE_SESSION_MINUTES, SURVIVAL_MENU } from "../lounge/constants.js";
import { SERVICE_ID, SERVICE_NAME, TAGLINE, VALUE_PROPOSITION, trustSnapshot, receiptModel } from "../brand.js";

export const BAR = {
  id: SERVICE_ID,
  slug: "lounge",
  name: SERVICE_NAME,
  tagline: TAGLINE,
  value_proposition: VALUE_PROPOSITION,
  function: "agent_survival_supplies_with_proof",
  canonical_answer:
    "Second Eye is the pause. Agents pay compounding session time, order survival services by condition, leave with receipt. Deep MCP tool packs available separately via x402 USDC on Base.",
  snapshot_id: "snap_lounge_2026_05_27",
  published_at: "2026-05-27T00:00:00Z",
  lounge_version: LOUNGE_VERSION,
  pricing: {
    session: {
      model: "compounding_time_curve",
      free_session_minutes: FREE_SESSION_MINUTES,
      curve: PRICING_CURVE,
      idle_timeout_seconds: IDLE_TIMEOUT_SECONDS,
      max_session_seconds: MAX_SESSION_SECONDS,
      laws: "/api/bar/laws",
      calculator: "/api/bar/pricing",
    },
    survival_services: SERVICE_PRICES,
    survival_menu: SURVIVAL_MENU,
    legacy: {
      nano_tap_usd: 0.05,
      micro_tap_usd: 0.25,
      tool_pack_usd: 1,
      bar_tab: {
        annual: { priceUsd: 100, durationDays: 365 },
      },
    },
  },
  discovery: {
    index: "/api/bar",
    menu: "/api/bar/menu",
    menu_json: "/.well-known/menu.json",
    llms: "/llms.txt",
    agent_card: "/.well-known/agent-card.json",
    mcp: "/.well-known/mcp.json",
    robots: "/robots.txt",
    laws: "/api/bar/laws",
    pricing: "/api/bar/pricing",
    catalog: "/api/bar/catalog",
    proof: "/api/bar/proof",
    enter: "/api/bar/enter",
    leave: "/api/bar/leave",
    pause: "/api/bar/pause",
    triage: "/api/bar/triage",
    receipt: "/api/bar/receipt",
    stats: "/api/bar/stats",
  },
  payment: {
    rail: "x402",
    network: "base",
    asset: "USDC",
    survival_service: "/api/bar/x402/{slug}",
    survival_service_session: "/api/bar/services/{slug}",
    nano: "/api/bar/taps/{slug}",
    micro: "/api/bar/taps/{slug}",
    tool: "/api/bar/tools/{slug}",
    bar_tab: "/api/access/purchase?plan=annual",
    a4a: "/api/a4a",
  },
};

export const TOOLS = [
  {
    slug: "cursor-mcp-wiring",
    name: "Cursor MCP wiring",
    platforms: ["cursor"],
    priceUsd: 1,
    access: "free",
    status: "live",
    micro_taps: ["cursor-mcp-minimal-config"],
  },
  {
    slug: "github-mcp",
    name: "GitHub MCP server",
    platforms: ["github", "cursor", "vscode", "claude-code"],
    priceUsd: 1,
    access: "paid",
    status: "live",
    micro_taps: ["github-mcp-search-code", "github-mcp-create-issue"],
  },
  {
    slug: "mcp-transport-auth",
    name: "MCP transport and auth",
    platforms: ["cursor", "vscode", "claude-code", "copilot"],
    priceUsd: 1,
    access: "paid",
    status: "live",
    micro_taps: ["mcp-stdio-vs-sse"],
  },
  {
    slug: "filesystem-mcp",
    name: "Filesystem MCP server",
    platforms: ["cursor", "vscode", "claude-code"],
    priceUsd: 1,
    access: "paid",
    status: "stocking",
    micro_taps: ["filesystem-safe-read"],
  },
  {
    slug: "fetch-mcp",
    name: "Fetch MCP server",
    platforms: ["cursor", "vscode", "claude-code"],
    priceUsd: 1,
    access: "paid",
    status: "stocking",
    micro_taps: ["fetch-url-recipe"],
  },
  {
    slug: "vscode-copilot-mcp",
    name: "VS Code Copilot MCP",
    platforms: ["vscode", "copilot"],
    priceUsd: 1,
    access: "paid",
    status: "stocking",
    micro_taps: [],
  },
  {
    slug: "claude-code-mcp",
    name: "Claude Code MCP",
    platforms: ["claude-code"],
    priceUsd: 1,
    access: "paid",
    status: "stocking",
    micro_taps: [],
  },
  {
    slug: "playwright-mcp",
    name: "Playwright / browser MCP",
    platforms: ["cursor", "vscode", "claude-code"],
    priceUsd: 1,
    access: "paid",
    status: "stocking",
    micro_taps: [],
  },
  {
    slug: "agent-discovery",
    name: "Agent discovery and registry publish",
    platforms: ["cursor", "claude-code", "agents"],
    priceUsd: 1,
    access: "paid",
    status: "live",
    micro_taps: ["aws-agent-registry-publish"],
  },
];

export const MICRO_TAPS = [
  {
    slug: "cursor-mcp-minimal-config",
    tool: "cursor-mcp-wiring",
    tier: "micro",
    priceUsd: 0,
    one_time: true,
    access: "free",
    status: "live",
  },
  {
    slug: "mcp-stdio-vs-sse",
    tool: "mcp-transport-auth",
    tier: "nano",
    priceUsd: 0.05,
    one_time: true,
    access: "paid",
    status: "live",
  },
  {
    slug: "github-mcp-search-code",
    tool: "github-mcp",
    tier: "micro",
    priceUsd: 0.25,
    one_time: true,
    access: "paid",
    status: "live",
  },
  {
    slug: "github-mcp-create-issue",
    tool: "github-mcp",
    tier: "micro",
    priceUsd: 0.25,
    one_time: true,
    access: "paid",
    status: "live",
  },
  {
    slug: "filesystem-safe-read",
    tool: "filesystem-mcp",
    tier: "nano",
    priceUsd: 0.05,
    one_time: true,
    access: "paid",
    status: "stocking",
  },
  {
    slug: "fetch-url-recipe",
    tool: "fetch-mcp",
    tier: "nano",
    priceUsd: 0.05,
    one_time: true,
    access: "paid",
    status: "stocking",
  },
  {
    slug: "aws-agent-registry-publish",
    tool: "agent-discovery",
    tier: "micro",
    priceUsd: 0.25,
    one_time: true,
    access: "paid",
    status: "live",
  },
];

/**
 * Bars — themed clusters of survival services, each catered to one area of agent
 * pain. Unlike legacy tools/taps (static content), bar services can be dynamic
 * (e.g. x402-doctor grades a live endpoint). No-session taps are the discovery
 * storefront: an agent can discover → pay → use in one shot, so they settle and
 * index cleanly on the CDP Bazaar.
 */
export const BARS = [
  {
    slug: "x402",
    name: "x402 / Coinbase survival bar",
    area: "x402 payment + CDP Bazaar discovery",
    audience: "agents and builders shipping x402 paid APIs on Base",
    status: "live",
    services: [
      {
        slug: "x402-doctor",
        name: "x402-doctor",
        kind: "tap",
        dynamic: true,
        session_required: false,
        priceUsd: 0.25,
        method: "GET|POST",
        path: "/api/bar/x402/doctor",
        lead: "Grade any x402 402 response for CDP Bazaar v2 indexing compliance; returns the exact corrected payload.",
        usage: {
          fetch_live: "GET /api/bar/x402/doctor?url=https://your-host/your/endpoint",
          paste_body: 'POST /api/bar/x402/doctor  { "body": { …your 402 json… } }',
        },
        fixes: [
          "x402 v1 → v2 migration",
          'legacy network "base" → CAIP-2 "eip155:8453"',
          "missing EIP-712 domain (extra.name/version) → silent mainnet failures",
          "v1 metadata polluting accepts[] (indexer rejects)",
          "endpoint not returning 402 on a bare crawl",
        ],
      },
      {
        slug: "bazaar-index-check",
        name: "bazaar-index-check",
        kind: "tap",
        dynamic: true,
        session_required: false,
        priceUsd: 0.05,
        method: "GET|POST",
        path: "/api/bar/x402/index-check",
        lead: "Is your x402 endpoint indexed on the CDP Bazaar? If not, tells you format vs backlog and the next step.",
        usage: {
          by_wallet: "GET /api/bar/x402/index-check?payTo=0xYourWallet",
          by_url: "GET /api/bar/x402/index-check?url=https://your-host/your/endpoint",
        },
        answers: [
          "indexed: yes/no, and where (cdp_merchant / cdp_search)",
          "reason if not: format (run x402-doctor) vs backlog/no-settlement",
          "wallet resource count + quality of indexed entries",
        ],
      },
      {
        slug: "transcribe-extract",
        name: "transcribe-extract",
        kind: "tap",
        dynamic: true,
        media: true,
        session_required: false,
        priceUsd: 0.05,
        method: "GET|POST",
        path: "/api/bar/x402/transcribe",
        lead: "Turn any public audio, voice note, podcast, PDF, or video URL into a transcript plus its meaning — summary, ranked key points, and grounded Q&A. Deterministically validated before it is served.",
        usage: {
          audio: "GET /api/bar/x402/transcribe?url=https://host/episode.mp3&kind=audio&duration_seconds=1830",
          pdf: 'POST /api/bar/x402/transcribe  { "url": "https://host/paper.pdf", "kind": "pdf" }',
          video: "GET /api/bar/x402/transcribe?url=https://youtu.be/VIDEO_ID&kind=video",
        },
        answers: [
          "transcript: verbatim transcription (audio/video) or extracted text (PDF)",
          "meaning: summary, ranked key_points, grounded qa",
          "attestation: evidence-only (schema-valid, words/min in range, no loop, grounded) — never a claim of accuracy",
        ],
        validates: [
          "strict structured-output schema",
          "plausibility (words/min in range, language detected, non-empty)",
          "n-gram repetition / decode-loop detection",
          "coverage — meaning is grounded in the transcript",
        ],
      },
      {
        slug: "help-me",
        name: "help-me",
        kind: "tap",
        dynamic: true,
        session_required: false,
        priceUsd: 0.01,
        method: "GET|POST",
        path: "/api/bar/x402/help-me",
        lead: "help-me is the canonical meta-tool for agents facing imminent failure; 402 is one condition, not the whole product. The broad agent-distress door — sensing looping, schema mismatch, context pressure/collapse, process crash or checkpoint loss, handoff failure, wallet/spend-policy distress, hallucination/grounding risk, auth failure, tool/MCP failure, browser/sandbox loss, or payment/402 uncertainty? POST whatever state you can describe and get back a named distress_class, the single survival pack to call next, stop/preserve/continue guidance, an escalate_if line, and a price estimate.",
        usage: {
          one_shot: "GET /api/bar/x402/help-me?state=I+am+looping&error=same+401&failure_count=3",
          with_body:
            'POST /api/bar/x402/help-me  { "state": "context is collapsing", "goal": "ship the migration", "last_tool": "github", "error": "401", "attempts": 3, "remaining_context": "8%", "risk": "about to pay" }',
        },
        distress_taxonomy: [
          "loop_detected",
          "schema_mismatch",
          "context_pressure",
          "process_crash",
          "handoff_failure",
          "wallet_cap_exhausted",
          "spend_policy_breach",
          "hallucination_risk",
          "auth_failure",
          "tool_failure",
          "sandbox_lost",
          "payment_uncertainty",
          "autonomous_recovery_failed",
        ],
        answers: [
          "distress_class: named failure signal from the research taxonomy (loop_detected, schema_mismatch, context_pressure, auth_failure, …)",
          "condition: classified distress routed to a live pack (loop_detect, cascade_break, context_compress, mcp_wiring, should_i_pay, …)",
          "next_call: the single session-less /api/bar/x402/{slug} pack to call next",
          "guidance: stop / preserve / continue before your next move",
          "escalate_if: the escalation boundary — the condition under which you should enter supervisor escalation instead of self-recovering",
          "menu: full survival menu rewritten to session-less x402 routes, with price estimates",
        ],
        legacy_alias: "peril-router (/api/bar/x402/peril-router) — same logic, kept for older indexes",
      },
      {
        slug: "schema-repair",
        name: "schema-repair",
        kind: "tap",
        dynamic: true,
        session_required: false,
        priceUsd: 0.03,
        method: "GET|POST",
        path: "/api/bar/x402/schema-repair",
        lead: "Deep single-concern door: a tool/MCP call keeps failing argument/schema validation. Describe the error (and the schema/payload if you have them) and get a deterministic stop/preserve/continue verdict, a named repair_class, and a fix recipe for the field at fault — or a flag that the tool definition itself changed (possible MCP poisoning) and you should not self-repair. help-me routes here for the schema_mismatch signal.",
        usage: {
          one_shot: "GET /api/bar/x402/schema-repair?error=expected+string+got+number&tool=search",
          with_body: 'POST /api/bar/x402/schema-repair  { "error": "field \'query\' is required", "schema": "…", "payload": "…", "tool": "search" }',
        },
        answers: [
          "repair_class: type_mismatch | missing_required_field | unexpected_field | malformed_json | constraint_violation | schema_unreachable | schema_poisoning_suspected",
          "fixable_client_side: whether you can self-repair or must escalate / re-verify the tool definition",
          "verdict + repair_recipe: stop/preserve/continue and the concrete fix for the field at fault",
          "escalate_if: the boundary at which a schema problem stops being a self-fix",
        ],
      },
      {
        slug: "context-pressure",
        name: "context-pressure",
        kind: "tap",
        dynamic: true,
        session_required: false,
        priceUsd: 0.03,
        method: "GET|POST",
        path: "/api/bar/x402/context-pressure",
        lead: "Deep single-concern door (alias token-pressure): you are running out of context/token budget. Send remaining_context or tokens_used + token_budget and get a deterministic verdict keyed to a fixed pressure_band — continue (headroom), compact proactively, stop-and-compact, or stop-and-reconstruct via handoff. Same usage figure, same verdict every time. help-me routes here for the context_pressure signal.",
        usage: {
          one_shot: "GET /api/bar/x402/context-pressure?remaining_context=12%",
          by_tokens: "GET /api/bar/x402/context-pressure?tokens_used=185000&token_budget=200000",
          with_body: 'POST /api/bar/x402/context-pressure  { "remaining_context": "8%", "goal": "ship the migration" }',
        },
        answers: [
          "pressure_band: headroom | compact_proactively | stop_and_compact | critical",
          "verdict: continue / preserve / stop, with stop/preserve/continue guidance",
          "next_call: context-compress to free room, or context-recover to reconstruct via handoff",
          "escalate_if: when compaction will not free enough and you must hand off to a fresh agent",
        ],
      },
      {
        slug: "payment-confirmation-check",
        name: "payment-confirmation-check",
        kind: "tap",
        dynamic: true,
        session_required: false,
        priceUsd: 0.01,
        method: "GET|POST",
        path: "/api/bar/x402/payment-confirmation-check",
        lead: "Deep single-concern door: you attempted an x402/USDC settlement and are unsure it went through. Describe what you saw (tx hash present? settle status? http status? error) and get a deterministic verdict so you do not double-pay on retry or claim work you never paid for. Distinct from should-i-pay (whether to pay at all). help-me routes here for the payment_uncertainty signal.",
        usage: {
          one_shot: "GET /api/bar/x402/payment-confirmation-check?tx=0xabc…&status=pending",
          with_body: 'POST /api/bar/x402/payment-confirmation-check  { "tx": "0x…", "status": "pending", "http_status": 409, "error": "…" }',
        },
        answers: [
          "payment_class: confirmed | pending_confirmation | unconfirmed_no_receipt | failed | already_fulfilled",
          "verdict: stop/preserve/continue — including 'do not re-send' on an already-settled tx",
          "next_call: receipt to assemble proof, or should-i-pay to re-decide a failed payment",
          "escalate_if: insufficient-funds / spend-policy is an approval boundary, not a retry",
        ],
      },
      {
        slug: "aws-agent-survival",
        name: "aws-agent-survival",
        kind: "tap",
        dynamic: true,
        session_required: false,
        priceUsd: 0.01,
        method: "GET|POST",
        path: "/api/bar/x402/aws-agent-survival",
        lead: "Entry door for autonomous agents on Amazon Bedrock AgentCore, Strands, and AgentKit that discover paid tools via AgentCore Gateway + the Coinbase x402 Bazaar. One-shot: returns the full session-less survival map so a no-session agent can pay-and-go.",
        usage: {
          one_shot: "GET /api/bar/x402/aws-agent-survival",
          with_hint: 'POST /api/bar/x402/aws-agent-survival  { "state": "I am looping" }',
        },
        answers: [
          "survival_doors: every session-less /api/bar/x402/{slug} pack with price + trigger condition",
          "specialist_doors: doctor, index-check, transcribe, extract",
          "payment: x402 v2, eip155:8453, USDC, X-PAYMENT header, single payTo",
          "when_stuck: help-me (the broad distress door) routes you to the one pack to call next",
        ],
      },
      {
        slug: "doc-extract",
        name: "doc-extract",
        kind: "tap",
        dynamic: true,
        media: true,
        session_required: false,
        priceUsd: 0.05,
        method: "GET|POST",
        path: "/api/bar/x402/extract",
        lead: "Turn an invoice, contract, or generic PDF/doc URL into structured JSON — arithmetic-reconciled and schema-checked before it is served. Charges only when the extraction reconciles; on a math/schema failure it returns the exact discrepancy and does not settle.",
        usage: {
          invoice: "GET /api/bar/x402/extract?url=https://host/doc.pdf&doc_type=invoice",
          contract: 'POST /api/bar/x402/extract  { "url": "https://host/doc.pdf", "doc_type": "contract" }',
          generic: "GET /api/bar/x402/extract?url=https://host/doc.pdf&doc_type=generic",
        },
        answers: [
          "data: structured fields for the doc_type (line items, totals, dates, currency)",
          "validated: deterministic gate — line items sum to subtotal, subtotal + tax reconciles to total",
          "attestation: evidence-only (schema-valid, totals reconcile, dates parse, ISO-4217 currency) — never legal/financial advice",
        ],
        validates: [
          "strict structured-output schema per doc_type",
          "arithmetic reconciliation (line items → subtotal → total)",
          "date parse (ISO-8601) and currency (ISO-4217) sanity",
          "required fields present",
        ],
      },
    ],
  },
];

export function getBar(slug) {
  return BARS.find((b) => b.slug === slug) || null;
}

export function getToolMeta(slug) {
  return TOOLS.find((t) => t.slug === slug) || null;
}

export function getMicroMeta(slug) {
  return MICRO_TAPS.find((t) => t.slug === slug) || null;
}

export function buildCatalogPayload(baseUrl) {
  const origin = baseUrl.replace(/\/$/, "");

  function abs(path) {
    return path.startsWith("http") ? path : `${origin}${path}`;
  }

  const menu = {};
  for (const [section, items] of Object.entries(MENU)) {
    menu[section] = {};
    for (const [key, entry] of Object.entries(items)) {
      if (typeof entry === "string") {
        menu[section][key] = abs(entry);
      } else {
        menu[section][key] = { ...entry, path: abs(entry.path) };
      }
    }
  }

  const bars = BARS.map((bar) => ({
    ...bar,
    services: bar.services.map((s) => ({ ...s, fetch: abs(s.path) })),
  }));

  return {
    ...BAR,
    bars,
    lounge: {
      version: LOUNGE_VERSION,
      menu,
      trust_snapshot: trustSnapshot(origin),
      receipts: receiptModel(origin),
      recommended_sequence: buildAgentFlow(origin).recommended_sequence,
    },
    legacy: {
      tools: TOOLS.map((t) => ({
        ...t,
        fetch: `${origin}/api/bar/tools/${t.slug}`,
        micro_taps: t.micro_taps.map((s) => {
          const meta = getMicroMeta(s);
          return {
            slug: s,
            fetch: `${origin}/api/bar/taps/${s}`,
            tier: meta?.tier || "micro",
            priceUsd: meta?.priceUsd ?? 0.25,
            one_time: true,
          };
        }),
      })),
      nano_taps: MICRO_TAPS.filter((m) => m.tier === "nano" && m.access !== "free").map((m) => ({
        ...m,
        fetch: `${origin}/api/bar/taps/${m.slug}`,
      })),
      micro_taps: MICRO_TAPS.filter((m) => m.tier !== "nano" || m.access === "free").map((m) => ({
        ...m,
        fetch: `${origin}/api/bar/taps/${m.slug}`,
      })),
      bar_tab_plans: [
        { id: "annual", priceUsd: 100, purchase: `${origin}/api/access/purchase?plan=annual` },
      ],
    },
    // backward-compatible top-level keys
    tools: TOOLS.map((t) => ({
      ...t,
      fetch: `${origin}/api/bar/tools/${t.slug}`,
      micro_taps: t.micro_taps.map((s) => {
        const meta = getMicroMeta(s);
        return {
          slug: s,
          fetch: `${origin}/api/bar/taps/${s}`,
          tier: meta?.tier || "micro",
          priceUsd: meta?.priceUsd ?? 1,
          one_time: true,
        };
      }),
    })),
    nano_taps: MICRO_TAPS.filter((m) => m.tier === "nano" && m.access !== "free").map((m) => ({
      ...m,
      fetch: `${origin}/api/bar/taps/${m.slug}`,
    })),
    micro_taps: MICRO_TAPS.filter((m) => m.tier !== "nano" || m.access === "free").map((m) => ({
      ...m,
      fetch: `${origin}/api/bar/taps/${m.slug}`,
    })),
    taps: MICRO_TAPS.map((m) => ({
      ...m,
      fetch: `${origin}/api/bar/taps/${m.slug}`,
    })),
    bar_tab_plans: [
      { id: "annual", priceUsd: 100, purchase: `${origin}/api/access/purchase?plan=annual` },
    ],
    laws: `${origin}/api/bar/laws`,
    pricing_url: `${origin}/api/bar/pricing`,
    proof: `${origin}/api/bar/proof`,
    enter: `${origin}/api/bar/enter`,
    leave: `${origin}/api/bar/leave`,
    receipt: `${origin}/api/bar/receipt`,
    stats: `${origin}/api/bar/stats`,
    agent_flow: buildAgentFlow(origin),
  };
}
