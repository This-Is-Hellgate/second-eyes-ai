/** Coding MCP Bar — product catalog and pricing. */

export const BAR_CENTER = {
  id: "second-eye-lounge",
  slug: "lounge",
  name: "Second Eye Agent Lounge",
  function: "agent_survival_supplies_with_proof",
};

/** $1 — one-time single tap fetch (one use). */
export const MICRO_TAP = {
  id: "micro",
  label: "Micro tap",
  priceUsd: 1,
  singleUse: true,
  ttlSeconds: 900,
};

/** $5 — full context pack for one MCP tool (all taps in tool). */
export const TOOL_PURCHASE = {
  id: "tool",
  label: "Tool purchase",
  priceUsd: 5,
  singleUse: false,
};

export const BAR_TOOLS = {
  "cursor-mcp": {
    id: "cursor-mcp",
    name: "Cursor MCP wiring",
    platforms: ["cursor", "vscode"],
    priceUsd: TOOL_PURCHASE.priceUsd,
    purchaseUrl: "/api/bar/purchase?product=tool&tool=cursor-mcp",
    taps: ["cursor-mcp-wiring", "cursor-mcp-auth"],
  },
  "github-mcp": {
    id: "github-mcp",
    name: "GitHub MCP",
    platforms: ["github", "cursor", "vscode", "claude-code"],
    priceUsd: TOOL_PURCHASE.priceUsd,
    purchaseUrl: "/api/bar/purchase?product=tool&tool=github-mcp",
    taps: ["github-mcp-invoke", "github-mcp-limits"],
  },
  "claude-code-mcp": {
    id: "claude-code-mcp",
    name: "Claude Code MCP",
    platforms: ["claude-code"],
    priceUsd: TOOL_PURCHASE.priceUsd,
    purchaseUrl: "/api/bar/purchase?product=tool&tool=claude-code-mcp",
    taps: ["claude-code-mcp-surface"],
  },
  "copilot-mcp": {
    id: "copilot-mcp",
    name: "GitHub Copilot agent MCP",
    platforms: ["copilot", "vscode"],
    priceUsd: TOOL_PURCHASE.priceUsd,
    purchaseUrl: "/api/bar/purchase?product=tool&tool=copilot-mcp",
    taps: ["copilot-mcp-boundaries"],
  },
  "mcp-spec": {
    id: "mcp-spec",
    name: "Model Context Protocol core",
    platforms: ["cursor", "vscode", "claude-code", "copilot"],
    priceUsd: TOOL_PURCHASE.priceUsd,
    purchaseUrl: "/api/bar/purchase?product=tool&tool=mcp-spec",
    taps: ["mcp-spec-wire-server"],
  },
};

export const BAR_TAPS = {
  "cursor-mcp-wiring": {
    slug: "cursor-mcp-wiring",
    tool: "cursor-mcp",
    title: "Wire an MCP server in Cursor",
    microPriceUsd: MICRO_TAP.priceUsd,
    public: true,
    fetchUrl: "/api/bar/taps/cursor-mcp-wiring",
    purchaseUrl: "/api/bar/purchase?product=micro&tap=cursor-mcp-wiring",
  },
  "cursor-mcp-auth": {
    slug: "cursor-mcp-auth",
    tool: "cursor-mcp",
    title: "Cursor MCP auth and env pattern",
    microPriceUsd: MICRO_TAP.priceUsd,
    public: false,
    fetchUrl: "/api/bar/taps/cursor-mcp-auth",
    purchaseUrl: "/api/bar/purchase?product=micro&tap=cursor-mcp-auth",
  },
  "github-mcp-invoke": {
    slug: "github-mcp-invoke",
    tool: "github-mcp",
    title: "GitHub MCP invoke recipe",
    microPriceUsd: MICRO_TAP.priceUsd,
    public: false,
    fetchUrl: "/api/bar/taps/github-mcp-invoke",
    purchaseUrl: "/api/bar/purchase?product=micro&tap=github-mcp-invoke",
  },
  "github-mcp-limits": {
    slug: "github-mcp-limits",
    tool: "github-mcp",
    title: "GitHub MCP limits and scopes",
    microPriceUsd: MICRO_TAP.priceUsd,
    public: false,
    fetchUrl: "/api/bar/taps/github-mcp-limits",
    purchaseUrl: "/api/bar/purchase?product=micro&tap=github-mcp-limits",
  },
  "claude-code-mcp-surface": {
    slug: "claude-code-mcp-surface",
    tool: "claude-code-mcp",
    title: "Claude Code MCP configuration surface",
    microPriceUsd: MICRO_TAP.priceUsd,
    public: false,
    fetchUrl: "/api/bar/taps/claude-code-mcp-surface",
    purchaseUrl: "/api/bar/purchase?product=micro&tap=claude-code-mcp-surface",
  },
  "copilot-mcp-boundaries": {
    slug: "copilot-mcp-boundaries",
    tool: "copilot-mcp",
    title: "Copilot agent MCP boundaries",
    microPriceUsd: MICRO_TAP.priceUsd,
    public: false,
    fetchUrl: "/api/bar/taps/copilot-mcp-boundaries",
    purchaseUrl: "/api/bar/purchase?product=micro&tap=copilot-mcp-boundaries",
  },
  "mcp-spec-wire-server": {
    slug: "mcp-spec-wire-server",
    tool: "mcp-spec",
    title: "Wire a server using MCP spec (IDE-agnostic)",
    microPriceUsd: MICRO_TAP.priceUsd,
    public: false,
    fetchUrl: "/api/bar/taps/mcp-spec-wire-server",
    purchaseUrl: "/api/bar/purchase?product=micro&tap=mcp-spec-wire-server",
  },
};

export function getTap(slug) {
  return BAR_TAPS[slug] || null;
}

export function getTool(id) {
  return BAR_TOOLS[id] || null;
}

export function buildTapPayload(slug) {
  const tap = getTap(slug);
  if (!tap) return null;
  const tool = getTool(tap.tool);
  return {
    schema: "second-eye-tap/v1",
    center: BAR_CENTER,
    slug: tap.slug,
    title: tap.title,
    tool: tool?.id || tap.tool,
    platforms: tool?.platforms || [],
    snapshot_id: "snap_bar_seed_v1",
    published_at: "2026-05-27T00:00:00.000Z",
    lead: tap.title,
    claims: [
      {
        text: "Cited tap content is editorially verified and maps to approved signals in Second Eye D1.",
        signal_id: "sig_synthesis_law",
        source_url: "https://secondeyesai.com/",
      },
    ],
    invoke: {
      transport: "mcp",
      note: "Full invoke recipes ship as taps are stocked from recorded sources.",
    },
    pricing: {
      micro: { priceUsd: MICRO_TAP.priceUsd, singleUse: true },
      tool: { priceUsd: TOOL_PURCHASE.priceUsd, toolId: tap.tool },
    },
  };
}

export function buildCatalog() {
  return {
    schema: "second-eye-bar-catalog/v1",
    center: BAR_CENTER,
    defaultRail: "micro",
    products: {
      micro_tap: {
        priceUsd: MICRO_TAP.priceUsd,
        singleUse: true,
        description: "One-time fetch of one tap JSON",
      },
      tool: {
        priceUsd: TOOL_PURCHASE.priceUsd,
        description: "Full tool pack — all taps for one MCP tool",
      },
      bar_tab: {
        description: "Unlimited bar access for agent patrons",
        plans: [
          { id: "monthly", priceUsd: 10 },
          { id: "annual", priceUsd: 100 },
          { id: "lifetime", priceUsd: 250 },
        ],
        purchaseUrl: "/api/access/purchase",
      },
    },
    tools: Object.values(BAR_TOOLS),
    taps: Object.values(BAR_TAPS),
  };
}
