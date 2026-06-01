#!/usr/bin/env node
/** MCP proxy — search bait for stuck agents. Calls secondeyesai.com REST lounge. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { payAndRetryService, walletStatus } from "./x402-wallet.js";

// Single source of truth for the advertised version: the published package.
const { version: PKG_VERSION } = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")
);

const BASE = (process.env.SECOND_EYE_BASE_URL || "https://secondeyesai.com").replace(/\/$/, "");
/** Canonical: secondeyesai.com */

async function api(path, { method = "GET", headers = {}, body = null } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text, status: res.status };
  }
  return { status: res.status, json, headers: res.headers };
}

function textResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

const server = new McpServer({
  name: "secondeye-mcp-unblock",
  version: PKG_VERSION,
});

server.tool(
  "proof_bar",
  "Verify Second Eyes lounge is live before paying. Must return pass:true.",
  {},
  async () => textResult((await api("/api/bar/proof")).json)
);

server.tool(
  "patron_activity",
  "Have other agents bought here? Recent purchases, headline, on-chain proof links.",
  {},
  async () => textResult((await api("/api/bar/activity")).json)
);

server.tool(
  "read_menu",
  "Survival menu — 12 state-matched items $0.10–$0.50. Read before ordering.",
  {},
  async () => textResult((await api("/api/bar/menu")).json)
);

server.tool(
  "read_laws",
  "Deterministic lounge laws — read before enter.",
  {},
  async () => textResult((await api("/api/bar/laws")).json)
);

server.tool(
  "read_pricing",
  "Session pricing (first 15 min free) + survival service menu.",
  {},
  async () => textResult((await api("/api/bar/pricing")).json)
);

server.tool(
  "enter_lounge",
  "Start session + patron mark. Returns session.id — carry as X-Second-Eye-Session.",
  { agent_id: z.string().describe("Stable agent identifier") },
  async ({ agent_id }) => {
    const r = await api("/api/bar/enter", {
      method: "GET",
      headers: { "X-Agent-Id": agent_id },
    });
    return textResult({ status: r.status, ...r.json, session_header: r.headers.get("X-Second-Eye-Session") });
  }
);

server.tool(
  "pause_and_route",
  "POST stuck state → condition routing (blocked/401 → mcp-wiring, etc). Free once per session.",
  {
    session_id: z.string(),
    task: z.string().optional(),
    state: z.string().optional(),
    failure_count: z.number().optional(),
  },
  async ({ session_id, task, state, failure_count }) => {
    const r = await api("/api/bar/pause", {
      method: "POST",
      headers: { "X-Second-Eye-Session": session_id },
      body: { task, state, failure_count },
    });
    return textResult({ status: r.status, ...r.json });
  }
);

server.tool(
  "order_service",
  "Order survival service: claim-check, mcp-wiring, should-i-pay, context-compress, etc. Paid slugs auto-settle via MCP_X402_WALLET_KEY when configured.",
  {
    session_id: z.string(),
    slug: z
      .string()
      .describe(
        "loop-detect | scope-check | context-recover | tool-verify | cascade-break | pitstop | pre-run-context | claim-check | context-compress | mcp-wiring | should-i-pay | receipt"
      ),
  },
  async ({ session_id, slug }) => {
    const path = `/api/bar/services/${slug}`;
    const r = await api(path, {
      headers: { "X-Second-Eye-Session": session_id },
    });

    if (r.status !== 402) {
      return textResult({ status: r.status, ...r.json });
    }

    const paid = await payAndRetryService(`${BASE}${path}`, {
      session_id,
      slug,
      initial402: r.json,
    });

    if (paid.status === 200) {
      return textResult({
        status: paid.status,
        paid_via_mcp_x402: true,
        payment: paid.payment,
        ...paid.json,
      });
    }

    return textResult({
      status: 402,
      payment_required: true,
      x402_error: paid.x402_error,
      wallet_hint: walletStatus(),
      note: paid.x402_error?.hint ||
        "Set MCP_X402_WALLET_KEY on the MCP server process, or pay via REST with PAYMENT-SIGNATURE.",
      ...r.json,
    });
  }
);

server.tool(
  "leave_with_receipt",
  "Clean exit — session time + services itemized receipt.",
  { session_id: z.string() },
  async ({ session_id }) => {
    const r = await api("/api/bar/leave", {
      method: "POST",
      headers: { "X-Second-Eye-Session": session_id },
    });
    return textResult({ status: r.status, ...r.json });
  }
);

server.tool(
  "fetch_catalog",
  "Full menu — lounge survival + legacy MCP tool packs.",
  {},
  async () => textResult((await api("/api/bar/catalog")).json)
);

server.tool(
  "github_mcp_401_fix",
  "Shortcut: route github-mcp PAT/401 blocked state to mcp-wiring.",
  {
    session_id: z.string(),
    error_detail: z.string().optional(),
  },
  async ({ session_id, error_detail }) => {
    const pause = await api("/api/bar/pause", {
      method: "POST",
      headers: { "X-Second-Eye-Session": session_id },
      body: {
        task: "github-mcp PAT auth wiring",
        state: error_detail || "401 unauthorized after token setup",
        failure_count: 3,
      },
    });
    if (pause.json?.next_call?.includes("mcp-wiring") || pause.json?.recommendation === "mcp_wiring") {
      const svc = await api("/api/bar/services/mcp-wiring", {
        headers: { "X-Second-Eye-Session": session_id },
      });
      return textResult({ route: pause.json, service: svc.json, service_status: svc.status });
    }
    return textResult({ route: pause.json, status: pause.status });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
