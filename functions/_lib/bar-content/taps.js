/** One-time taps — nano ($0.25) or micro ($1) single fetch. */

import { getAwsAgentRegistryPublishPack } from "./packs/aws-agent-registry-publish.js";

const TAPS = {
  "cursor-mcp-minimal-config": {
    slug: "cursor-mcp-minimal-config",
    tap_type: "micro_invoke",
    tier: "micro",
    price_usd: 0,
    one_time: true,
    tool: "cursor-mcp-wiring",
    access: "free",
    lead: "Minimal Cursor mcp.json block for one stdio server.",
    invoke: {
      mcpServers: {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/absolute/path/to/root"],
        },
      },
    },
    claims: [
      {
        text: "Project MCP config lives at .cursor/mcp.json in Cursor.",
        signal_id: "sig_cursor_mcp_docs",
        source_url: "https://docs.cursor.com/context/model-context-protocol",
      },
    ],
  },

  "mcp-stdio-vs-sse": {
    slug: "mcp-stdio-vs-sse",
    tap_type: "nano_invoke",
    tier: "nano",
    price_usd: 0.25,
    one_time: true,
    tool: "mcp-transport-auth",
    access: "paid",
    lead: "When to use stdio vs SSE for MCP in coding agents.",
    invoke: {
      rule: "Local subprocess server → stdio. Remote hosted server → SSE or streamable HTTP.",
      stdio: "Cursor/VS Code spawn command from mcp.json",
      sse: "URL endpoint; check server docs for auth headers",
    },
    claims: [
      {
        text: "MCP defines stdio and HTTP-based transports for client-server communication.",
        signal_id: "sig_mcp_spec_transport",
        source_url: "https://modelcontextprotocol.io/specification/2025-03-26/basic/transports",
      },
    ],
  },

  "github-mcp-search-code": {
    slug: "github-mcp-search-code",
    tap_type: "micro_invoke",
    tier: "micro",
    price_usd: 1,
    one_time: true,
    tool: "github-mcp",
    access: "paid",
    lead: "Single invoke: GitHub MCP search_code.",
    invoke: {
      tool: "search_code",
      params: { query: "repo:owner/name extension:ts MCP", page: 1, per_page: 10 },
    },
    claims: [
      {
        text: "GitHub MCP server provides search_code for repository code search.",
        signal_id: "sig_github_mcp_server",
        source_url: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
      },
    ],
  },

  "github-mcp-create-issue": {
    slug: "github-mcp-create-issue",
    tap_type: "micro_invoke",
    tier: "micro",
    price_usd: 1,
    one_time: true,
    tool: "github-mcp",
    access: "paid",
    lead: "Single invoke: GitHub MCP create_issue.",
    invoke: {
      tool: "create_issue",
      params: {
        owner: "owner",
        repo: "repo",
        title: "Title",
        body: "Body with cited context.",
      },
    },
    claims: [
      {
        text: "GitHub MCP server exposes create_issue for repository issue creation.",
        signal_id: "sig_github_mcp_server",
        source_url: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
      },
    ],
  },

  "aws-agent-registry-publish": {
    slug: "aws-agent-registry-publish",
    tap_type: "micro_pack",
    tier: "micro",
    price_usd: 1,
    one_time: true,
    tool: "agent-discovery",
    access: "paid",
    lead: "Publish MCP to AWS Agent Registry — protocols, pitfalls, live CLI payloads.",
    pack: getAwsAgentRegistryPublishPack(),
    claims: getAwsAgentRegistryPublishPack().claims,
  },
};

export function getMicroTap(slug) {
  return TAPS[slug] || null;
}

export function isMicroLive(slug) {
  return Boolean(TAPS[slug]);
}
