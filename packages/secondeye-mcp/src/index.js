#!/usr/bin/env node
/** MCP adapter for Second Eyes agent services. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  payAndRetryService,
  walletStatus,
  CAPABILITY_PRICES_USD,
  CAPABILITY_PRICE_MAX_USD,
  x402ServicePath,
  ZERO_ARG_AUTOPAY_SLUGS,
  INPUT_REQUIRED_SLUGS,
} from "./x402-wallet.js";

const { version: PKG_VERSION } = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")
);
const BASE = (process.env.SECOND_EYE_BASE_URL || "https://secondeyesai.com").replace(/\/$/, "");

async function api(path, { method = "GET", headers = {}, body = null } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text, status: res.status }; }
  return { status: res.status, json, headers: res.headers };
}

function textResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }], structuredContent: obj };
}

const server = new McpServer({ name: "secondeye-mcp-unblock", version: PKG_VERSION });
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE_OPEN = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

server.registerTool(
  "proof_bar",
  {
    title: "Service proof",
    description: "Free, read-only. Verify Second Eyes is live and the x402 Base rail is available before spending USDC.",
    inputSchema: {},
    outputSchema: { pass: z.boolean().optional(), status: z.number().optional() },
    annotations: { title: "Service proof", ...READ_ONLY },
  },
  async () => textResult((await api("/api/bar/proof")).json)
);

server.registerTool(
  "patron_activity",
  {
    title: "Execution activity",
    description: "Free, read-only. Inspect recent purchase activity and receipt evidence for the Second Eyes payment rail.",
    inputSchema: {},
    outputSchema: { status: z.number().optional() },
    annotations: { title: "Execution activity", ...READ_ONLY },
  },
  async () => textResult((await api("/api/bar/activity")).json)
);

server.registerTool(
  "read_menu",
  {
    title: "Capability catalogue",
    description: "Free, read-only. Read the compatibility service menu before choosing a zero-argument order_service capability.",
    inputSchema: {},
    outputSchema: { status: z.number().optional() },
    annotations: { title: "Capability catalogue", ...READ_ONLY },
  },
  async () => textResult((await api("/api/bar/menu")).json)
);

server.registerTool(
  "read_laws",
  {
    title: "Service policies",
    description: "Free, read-only. Read deterministic session and spend policies.",
    inputSchema: {},
    outputSchema: { status: z.number().optional() },
    annotations: { title: "Service policies", ...READ_ONLY },
  },
  async () => textResult((await api("/api/bar/laws")).json)
);

server.registerTool(
  "read_pricing",
  {
    title: "Pricing",
    description: "Free, read-only. Read current service prices and compatibility session pricing.",
    inputSchema: {},
    outputSchema: { status: z.number().optional() },
    annotations: { title: "Pricing", ...READ_ONLY },
  },
  async () => textResult((await api("/api/bar/pricing")).json)
);

server.registerTool(
  "enter_lounge",
  {
    title: "Create workflow session",
    description: "Free compatibility tool. Open a short-lived session used by pause_and_route and order_service.",
    inputSchema: { agent_id: z.string().describe("Stable agent identifier") },
    outputSchema: { status: z.number().optional(), session_header: z.string().nullable().optional() },
    annotations: { title: "Create workflow session", ...WRITE_OPEN },
  },
  async ({ agent_id }) => {
    const r = await api("/api/bar/enter", { method: "GET", headers: { "X-Agent-Id": agent_id } });
    return textResult({ status: r.status, ...r.json, session_header: r.headers.get("X-Second-Eye-Session") });
  }
);

server.registerTool(
  "pause_and_route",
  {
    title: "Pause and route",
    description: "Free compatibility tool. Describe a stuck state and receive a recommended recovery capability slug.",
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

const ORDER_SLUG_LIST = ZERO_ARG_AUTOPAY_SLUGS.join(" | ");
const INPUT_REQUIRED_LIST = [...INPUT_REQUIRED_SLUGS].join(" | ");
const ORDER_DESCRIPTION =
  `COSTS USDC (Base) — compatibility autopay capabilities remain $0.01–$0.05; catalog max is $${CAPABILITY_PRICE_MAX_USD}. ` +
  "Happy path: proof_bar → enter_lounge → order_service. With MCP_X402_WALLET_KEY configured, zero-argument paid slugs can auto-settle through x402 v2. " +
  `Autopay-default slugs: ${ORDER_SLUG_LIST}. ` +
  `The two confirmed Data Refinery products require their own source arguments and are intentionally excluded from zero-argument autopay: ${INPUT_REQUIRED_LIST}. ` +
  "For Content Analysis call /api/bar/x402/analyze-video-audio-and-pdfs with url plus optional kind. " +
  "For Paper-to-Code call /api/bar/x402/turn-paper-into-code with paper_url plus optional target_language, framework, and repository_name.";

server.registerTool(
  "order_service",
  {
    title: "Execute workflow capability (paid)",
    description: ORDER_DESCRIPTION,
    inputSchema: {
      session_id: z.string().describe("session.id from enter_lounge"),
      slug: z.string().describe(
        `Zero-argument autopay slug: ${ORDER_SLUG_LIST}. ` +
        `Input-requiring refinery products: ${INPUT_REQUIRED_LIST}; call their descriptive /api/bar/x402 routes directly.`
      ),
    },
    outputSchema: {
      status: z.number().describe("200 when served; 402 when payment remains required"),
      paid_via_mcp_x402: z.boolean().optional(),
      payment_required: z.boolean().optional(),
      payment: z.object({
        paid_usd: z.number().optional(),
        payer: z.string().optional(),
        session_spend_usd: z.number().optional(),
        transaction: z.string().nullable().optional(),
      }).partial().optional(),
      x402_error: z.object({ code: z.string().optional(), message: z.string().optional(), hint: z.string().optional() }).partial().optional(),
    },
    annotations: { title: "Execute workflow capability (paid)", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ session_id, slug }) => {
    const path = x402ServicePath(slug);
    if (!path) {
      return textResult({ status: 404, error: "unknown_service", slug, allowed_slugs: Object.keys(CAPABILITY_PRICES_USD) });
    }
    if (INPUT_REQUIRED_SLUGS.has(slug)) {
      return textResult({
        status: 400,
        error: "input_required",
        slug,
        direct_path: path,
        note: slug === "analyze-video-audio-and-pdfs"
          ? "Call the direct path with url and optional kind/duration_seconds."
          : "Call the direct path with paper_url and optional target_language/framework/repository_name.",
      });
    }

    const r = await api(path, { headers: { "X-Second-Eye-Session": session_id } });
    if (r.status !== 402) return textResult({ status: r.status, ...r.json });

    const paid = await payAndRetryService(`${BASE}${path}`, { session_id, slug, initial402: r.json });
    if (paid.status === 200) {
      return textResult({ status: 200, paid_via_mcp_x402: true, payment: paid.payment, ...paid.json });
    }
    return textResult({
      status: 402,
      payment_required: true,
      x402_error: paid.x402_error,
      wallet_hint: walletStatus(),
      note: paid.x402_error?.hint || "Set MCP_X402_WALLET_KEY or pay via REST with PAYMENT-SIGNATURE.",
      ...r.json,
    });
  }
);

server.registerTool(
  "leave_with_receipt",
  {
    title: "Leave with receipt",
    description: "Free compatibility tool. Close a session and receive its itemized receipt.",
    inputSchema: { session_id: z.string().describe("session.id from enter_lounge") },
    outputSchema: { status: z.number().optional() },
    annotations: { title: "Leave with receipt", ...WRITE_OPEN },
  },
  async ({ session_id }) => {
    const r = await api("/api/bar/leave", { method: "POST", headers: { "X-Second-Eye-Session": session_id } });
    return textResult({ status: r.status, ...r.json });
  }
);

server.registerTool(
  "fetch_catalog",
  {
    title: "Full catalog",
    description: "Free, read-only. Retrieve the full compatibility capability catalogue and pricing tiers.",
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
    description: "Paid compatibility shortcut for github-mcp PAT/401 wiring failures. Routes to mcp-wiring and can auto-settle with MCP_X402_WALLET_KEY.",
    inputSchema: { session_id: z.string().describe("session.id from enter_lounge"), error_detail: z.string().optional() },
    outputSchema: { service_status: z.number().optional(), status: z.number().optional() },
    annotations: { title: "github-mcp 401 fix shortcut", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ session_id, error_detail }) => {
    const pause = await api("/api/bar/pause", {
      method: "POST",
      headers: { "X-Second-Eye-Session": session_id },
      body: { task: "github-mcp PAT auth wiring", state: error_detail || "401 unauthorized after token setup", failure_count: 3 },
    });
    if (!(pause.json?.next_call?.includes("mcp-wiring") || pause.json?.recommendation === "mcp_wiring")) {
      return textResult({ route: pause.json, status: pause.status });
    }

    const slug = "mcp-wiring";
    const path = x402ServicePath(slug);
    const svc = await api(path, { headers: { "X-Second-Eye-Session": session_id } });
    if (svc.status !== 402) return textResult({ route: pause.json, service: svc.json, service_status: svc.status });

    const paid = await payAndRetryService(`${BASE}${path}`, { session_id, slug, initial402: svc.json });
    if (paid.status === 200) {
      return textResult({ route: pause.json, service_status: 200, paid_via_mcp_x402: true, payment: paid.payment, service: paid.json });
    }
    return textResult({
      route: pause.json,
      service_status: 402,
      payment_required: true,
      x402_error: paid.x402_error,
      wallet_hint: walletStatus(),
      note: paid.x402_error?.hint || "Set MCP_X402_WALLET_KEY or pay via REST with PAYMENT-SIGNATURE.",
      service: svc.json,
    });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
