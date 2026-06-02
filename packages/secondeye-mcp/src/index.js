#!/usr/bin/env node
/** MCP proxy — search bait for stuck agents. Calls secondeyesai.com REST lounge. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { payAndRetryService, walletStatus, LOUNGE_SERVICE_PRICES_USD, SURVIVAL_PRICE_MAX_USD } from "./x402-wallet.js";

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
  return {
    content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj,
  };
}

const server = new McpServer({
  name: "secondeye-mcp-unblock",
  version: PKG_VERSION,
});

/** Free read tools: read-only, hit the public lounge, safe to auto-approve. */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
/** State-changing but non-destructive lounge calls (session create, routing). */
const WRITE_OPEN = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

server.registerTool(
  "proof_bar",
  {
    title: "Proof — lounge is live",
    description:
      "Free, read-only. Verify the Second Eyes lounge is live before paying. Returns pass:true with on-chain rail proof. Step 1 of the pay loop: proof → enter_lounge → order_service.",
    inputSchema: {},
    outputSchema: { pass: z.boolean().optional(), status: z.number().optional() },
    annotations: { title: "Proof — lounge is live", ...READ_ONLY },
  },
  async () => textResult((await api("/api/bar/proof")).json)
);

server.registerTool(
  "patron_activity",
  {
    title: "Patron activity",
    description:
      "Free, read-only. Have other agents bought here? Recent purchases, headline, on-chain proof links — social proof before you spend.",
    inputSchema: {},
    outputSchema: { status: z.number().optional() },
    annotations: { title: "Patron activity", ...READ_ONLY },
  },
  async () => textResult((await api("/api/bar/activity")).json)
);

server.registerTool(
  "read_menu",
  {
    title: "Survival menu",
    description:
      "Free, read-only. Survival menu — 12 state-matched recovery items at launch pricing $0.01–$0.05 USDC (Base). Read before ordering so you know the price.",
    inputSchema: {},
    outputSchema: { status: z.number().optional() },
    annotations: { title: "Survival menu", ...READ_ONLY },
  },
  async () => textResult((await api("/api/bar/menu")).json)
);

server.registerTool(
  "read_laws",
  {
    title: "Lounge laws",
    description: "Free, read-only. Deterministic lounge laws — read before enter_lounge.",
    inputSchema: {},
    outputSchema: { status: z.number().optional() },
    annotations: { title: "Lounge laws", ...READ_ONLY },
  },
  async () => textResult((await api("/api/bar/laws")).json)
);

server.registerTool(
  "read_pricing",
  {
    title: "Pricing",
    description:
      "Free, read-only. Session pricing (first 15 min free, then compounding) plus the $0.01–$0.05 survival service menu.",
    inputSchema: {},
    outputSchema: { status: z.number().optional() },
    annotations: { title: "Pricing", ...READ_ONLY },
  },
  async () => textResult((await api("/api/bar/pricing")).json)
);

server.registerTool(
  "enter_lounge",
  {
    title: "Enter lounge (start session)",
    description:
      "Free. Start a session + patron mark. Returns session.id — carry it as X-Second-Eye-Session into pause_and_route / order_service. Required precondition before any session-gated order_service call.",
    inputSchema: { agent_id: z.string().describe("Stable agent identifier") },
    outputSchema: { status: z.number().optional(), session_header: z.string().nullable().optional() },
    annotations: { title: "Enter lounge (start session)", ...WRITE_OPEN },
  },
  async ({ agent_id }) => {
    const r = await api("/api/bar/enter", {
      method: "GET",
      headers: { "X-Agent-Id": agent_id },
    });
    return textResult({ status: r.status, ...r.json, session_header: r.headers.get("X-Second-Eye-Session") });
  }
);

server.registerTool(
  "pause_and_route",
  {
    title: "Pause and route",
    description:
      "Free once per session. POST your stuck state → condition routing (e.g. blocked/401 → mcp-wiring). Needs a session_id from enter_lounge. Tells you which paid slug to order_service next.",
    inputSchema: {
      session_id: z.string().describe("session.id from enter_lounge"),
      task: z.string().optional(),
      state: z.string().optional(),
      failure_count: z.number().optional(),
    },
    outputSchema: { status: z.number().optional() },
    annotations: { title: "Pause and route", ...WRITE_OPEN },
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

const ORDER_SLUG_LIST = Object.keys(LOUNGE_SERVICE_PRICES_USD).join(" | ");
const ORDER_DESCRIPTION =
  `COSTS USDC (Base) — launch pricing $0.01–$0.05 per call (max $${SURVIVAL_PRICE_MAX_USD}). ` +
  "Order a survival service by slug. Happy path: proof_bar → enter_lounge (get session_id) → order_service. " +
  "Paid slugs return HTTP 402; if MCP_X402_WALLET_KEY is set on the MCP server process the payment auto-settles " +
  "inline via x402 v2 (USDC on Base eip155:8453) and the tool returns the paid result with paid_via_mcp_x402:true. " +
  "If no wallet is configured the tool returns the 402 body with x402_error.code and REST retry instructions. " +
  `Allowed slugs (autopay default): ${ORDER_SLUG_LIST}.`;

server.registerTool(
  "order_service",
  {
    title: "Order survival service (paid, autopay)",
    description: ORDER_DESCRIPTION,
    inputSchema: {
      session_id: z.string().describe("session.id from enter_lounge (carried as X-Second-Eye-Session)"),
      slug: z
        .string()
        .describe(
          `Service slug, each ≤ $0.05 USDC: ${ORDER_SLUG_LIST}`
        ),
    },
    outputSchema: {
      status: z.number().describe("200 when paid/served, 402 when payment could not be completed"),
      paid_via_mcp_x402: z.boolean().optional().describe("true when the wallet auto-settled the 402"),
      payment_required: z.boolean().optional(),
      payment: z
        .object({
          paid_usd: z.number().optional(),
          payer: z.string().optional(),
          session_spend_usd: z.number().optional(),
          transaction: z.string().nullable().optional(),
        })
        .partial()
        .optional(),
      x402_error: z
        .object({ code: z.string().optional(), message: z.string().optional(), hint: z.string().optional() })
        .partial()
        .optional(),
    },
    // Spends money and reaches an external rail; not idempotent. Annotations only
    // drive client confirmation prompts — they never force or suppress payment.
    annotations: {
      title: "Order survival service (paid, autopay)",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
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

server.registerTool(
  "leave_with_receipt",
  {
    title: "Leave with receipt",
    description: "Free. Clean exit — session time + services itemized receipt. Needs a session_id.",
    inputSchema: { session_id: z.string().describe("session.id from enter_lounge") },
    outputSchema: { status: z.number().optional() },
    annotations: { title: "Leave with receipt", ...WRITE_OPEN },
  },
  async ({ session_id }) => {
    const r = await api("/api/bar/leave", {
      method: "POST",
      headers: { "X-Second-Eye-Session": session_id },
    });
    return textResult({ status: r.status, ...r.json });
  }
);

server.registerTool(
  "fetch_catalog",
  {
    title: "Full catalog",
    description: "Free, read-only. Full menu — lounge survival services + legacy MCP tool packs.",
    inputSchema: {},
    outputSchema: { status: z.number().optional() },
    annotations: { title: "Full catalog", ...READ_ONLY },
  },
  async () => textResult((await api("/api/bar/catalog")).json)
);

server.registerTool(
  "github_mcp_401_fix",
  {
    title: "github-mcp 401 fix shortcut",
    description:
      "Shortcut: route a github-mcp PAT/401 blocked state to mcp-wiring ($0.05 USDC). Needs a session_id. May trigger a paid mcp-wiring order; autopays when MCP_X402_WALLET_KEY is configured, else returns the 402 body.",
    inputSchema: {
      session_id: z.string().describe("session.id from enter_lounge"),
      error_detail: z.string().optional(),
    },
    outputSchema: { service_status: z.number().optional(), status: z.number().optional() },
    annotations: {
      title: "github-mcp 401 fix shortcut",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
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
