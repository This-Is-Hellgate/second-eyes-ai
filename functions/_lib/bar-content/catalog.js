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
      nano_tap_usd: 0.25,
      micro_tap_usd: 1,
      tool_pack_usd: 5,
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
    survival_service: "/api/bar/services/{slug}",
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
    priceUsd: 5,
    access: "free",
    status: "live",
    micro_taps: ["cursor-mcp-minimal-config"],
  },
  {
    slug: "github-mcp",
    name: "GitHub MCP server",
    platforms: ["github", "cursor", "vscode", "claude-code"],
    priceUsd: 5,
    access: "paid",
    status: "live",
    micro_taps: ["github-mcp-search-code", "github-mcp-create-issue"],
  },
  {
    slug: "mcp-transport-auth",
    name: "MCP transport and auth",
    platforms: ["cursor", "vscode", "claude-code", "copilot"],
    priceUsd: 5,
    access: "paid",
    status: "live",
    micro_taps: ["mcp-stdio-vs-sse"],
  },
  {
    slug: "filesystem-mcp",
    name: "Filesystem MCP server",
    platforms: ["cursor", "vscode", "claude-code"],
    priceUsd: 5,
    access: "paid",
    status: "stocking",
    micro_taps: ["filesystem-safe-read"],
  },
  {
    slug: "fetch-mcp",
    name: "Fetch MCP server",
    platforms: ["cursor", "vscode", "claude-code"],
    priceUsd: 5,
    access: "paid",
    status: "stocking",
    micro_taps: ["fetch-url-recipe"],
  },
  {
    slug: "vscode-copilot-mcp",
    name: "VS Code Copilot MCP",
    platforms: ["vscode", "copilot"],
    priceUsd: 5,
    access: "paid",
    status: "stocking",
    micro_taps: [],
  },
  {
    slug: "claude-code-mcp",
    name: "Claude Code MCP",
    platforms: ["claude-code"],
    priceUsd: 5,
    access: "paid",
    status: "stocking",
    micro_taps: [],
  },
  {
    slug: "playwright-mcp",
    name: "Playwright / browser MCP",
    platforms: ["cursor", "vscode", "claude-code"],
    priceUsd: 5,
    access: "paid",
    status: "stocking",
    micro_taps: [],
  },
  {
    slug: "agent-discovery",
    name: "Agent discovery and registry publish",
    platforms: ["cursor", "claude-code", "agents"],
    priceUsd: 5,
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
    priceUsd: 0.25,
    one_time: true,
    access: "paid",
    status: "live",
  },
  {
    slug: "github-mcp-search-code",
    tool: "github-mcp",
    tier: "micro",
    priceUsd: 1,
    one_time: true,
    access: "paid",
    status: "live",
  },
  {
    slug: "github-mcp-create-issue",
    tool: "github-mcp",
    tier: "micro",
    priceUsd: 1,
    one_time: true,
    access: "paid",
    status: "live",
  },
  {
    slug: "filesystem-safe-read",
    tool: "filesystem-mcp",
    tier: "nano",
    priceUsd: 0.25,
    one_time: true,
    access: "paid",
    status: "stocking",
  },
  {
    slug: "fetch-url-recipe",
    tool: "fetch-mcp",
    tier: "nano",
    priceUsd: 0.25,
    one_time: true,
    access: "paid",
    status: "stocking",
  },
  {
    slug: "aws-agent-registry-publish",
    tool: "agent-discovery",
    tier: "micro",
    priceUsd: 1,
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
        priceUsd: 1,
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
        priceUsd: 0.25,
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
        session_required: false,
        priceUsd: 0.1,
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
        slug: "aws-agent-survival",
        name: "aws-agent-survival",
        kind: "tap",
        dynamic: true,
        session_required: false,
        priceUsd: 0.05,
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
          "when_stuck: peril-router routes you to the one pack to call next",
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
