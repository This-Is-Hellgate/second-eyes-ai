/** Live tool packs — cited JSON for agent pre-run context. */

const PACKS = {
  "cursor-mcp-wiring": {
    slug: "cursor-mcp-wiring",
    tap_type: "tool_pack",
    price_usd: 1,
    access: "free",
    snapshot_id: "snap_cursor_mcp_wiring_2026_05_27",
    published_at: "2026-05-27T00:00:00Z",
    platforms: ["cursor"],
    lead: "How to register MCP servers in Cursor — project vs global config, stdio transport, env for secrets.",
    capability_map: {
      config_paths: [
        { scope: "project", path: ".cursor/mcp.json" },
        { scope: "global", path: "~/.cursor/mcp.json" },
      ],
      transport: ["stdio"],
      notes: "Cursor loads MCP servers from mcp.json; each server is a command + args + optional env.",
    },
    auth_wiring: {
      pattern: "env_vars_in_mcp_json",
      example: { MY_API_TOKEN: "${env:MY_API_TOKEN}" },
      never_commit: ["tokens", "private keys"],
    },
    invoke_recipes: [
      {
        id: "minimal_stdio_server",
        description: "Minimal stdio MCP server block",
        config: {
          mcpServers: {
            example: {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/root"],
            },
          },
        },
      },
    ],
    claims: [
      {
        text: "Cursor reads MCP server definitions from mcp.json at project or user scope.",
        signal_id: "sig_cursor_mcp_docs",
        source_url: "https://docs.cursor.com/context/model-context-protocol",
      },
    ],
    sources: [
      {
        title: "Cursor MCP documentation",
        url: "https://docs.cursor.com/context/model-context-protocol",
      },
    ],
  },

  "github-mcp": {
    slug: "github-mcp",
    tap_type: "tool_pack",
    price_usd: 1,
    access: "paid",
    snapshot_id: "snap_github_mcp_2026_05_27",
    published_at: "2026-05-27T00:00:00Z",
    platforms: ["github", "cursor", "vscode", "claude-code"],
    lead: "Official GitHub MCP server — repo, issue, PR, and search tools with PAT auth via env.",
    capability_map: {
      package: "@modelcontextprotocol/server-github",
      tools: [
        "create_issue",
        "search_code",
        "get_file_contents",
        "create_pull_request",
        "list_issues",
      ],
      auth: "GITHUB_PERSONAL_ACCESS_TOKEN",
    },
    auth_wiring: {
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_..." },
      cursor_block: {
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${env:GITHUB_PERSONAL_ACCESS_TOKEN}" },
          },
        },
      },
    },
    invoke_recipes: [
      {
        id: "search_code",
        tool: "search_code",
        params: { query: "repo:owner/name MCP", page: 1, per_page: 5 },
      },
      {
        id: "create_issue",
        tool: "create_issue",
        params: { owner: "owner", repo: "repo", title: "Agent opened issue", body: "Cited context from Second Eye bar." },
      },
    ],
    changelog_delta: {
      as_of: "2026-05-27",
      note: "Verify tool names against installed server version before invoking.",
    },
    claims: [
      {
        text: "The official GitHub MCP server exposes repository, issue, PR, and search tools via stdio.",
        signal_id: "sig_github_mcp_server",
        source_url: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
      },
    ],
    sources: [
      {
        title: "MCP servers — GitHub",
        url: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
      },
    ],
  },

  "mcp-transport-auth": {
    slug: "mcp-transport-auth",
    tap_type: "tool_pack",
    price_usd: 1,
    access: "paid",
    snapshot_id: "snap_mcp_transport_2026_05_27",
    published_at: "2026-05-27T00:00:00Z",
    platforms: ["cursor", "vscode", "claude-code", "copilot"],
    lead: "MCP transports (stdio, SSE, streamable HTTP) and where auth belongs — env, headers, OAuth.",
    capability_map: {
      transports: [
        { id: "stdio", use: "Local server subprocess — default for IDE agents" },
        { id: "sse", use: "Remote server — long-lived event stream" },
        { id: "streamable_http", use: "Remote server — HTTP POST + optional SSE" },
      ],
    },
    auth_wiring: {
      stdio: "Secrets in mcp.json env block or host environment — never in tool args logged by LLM",
      remote: "Bearer tokens or OAuth as required by server; check server README",
    },
    claims: [
      {
        text: "MCP supports multiple transports; stdio is typical for local coding agents.",
        signal_id: "sig_mcp_spec_transport",
        source_url: "https://modelcontextprotocol.io/specification/2025-03-26/basic/transports",
      },
    ],
    sources: [
      {
        title: "MCP transports",
        url: "https://modelcontextprotocol.io/specification/2025-03-26/basic/transports",
      },
    ],
  },
};

const STUB = (slug, name) => ({
  slug,
  tap_type: "tool_pack",
  price_usd: 1,
  access: "paid",
  status: "stocking",
  lead: `${name} — pack in progress. Catalog listing is live; full cited JSON shipping next.`,
  claims: [],
  sources: [],
});

export function getToolPack(slug) {
  if (PACKS[slug]) return PACKS[slug];
  const meta = { slug, name: slug };
  return STUB(slug, slug);
}

export function isToolLive(slug) {
  const p = PACKS[slug];
  return Boolean(p && p.status !== "stocking");
}
