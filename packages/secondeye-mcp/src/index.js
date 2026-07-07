#!/usr/bin/env node
/** MCP adapter for Second Eyes workflow services. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { payAndRetryService, walletStatus, CAPABILITY_PRICES_USD, CAPABILITY_PRICE_MAX_USD, x402ServicePath, ZERO_ARG_AUTOPAY_SLUGS, INPUT_REQUIRED_SLUGS } from "./x402-wallet.js";

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

/** Free read tools: read-only service discovery, safe to auto-approve. */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
/** State-changing but non-destructive workflow calls (session create, routing). */
const WRITE_OPEN = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

server.registerTool(
  "proof_bar",
  {
    title: "Service proof",
    description:
      "Free, read-only. Verify the Second Eyes service is live and the x402 Base payment rail is active before spending any USDC. Returns pass:true with per-rail evidence. Run this first — if pass is false, no paid call will succeed. Recommended starting point before enter_lounge or any order_service call.",
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
    description:
      "Free, read-only. Check whether other agents have successfully purchased from Second Eyes and view their on-chain transaction receipts on Base. Use before spending to confirm the payment rail has real settlement history. Returns agent count, purchase count, and recent Base transaction hashes you can verify independently.",
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
    description:
      "Free, read-only. List all 12 recovery and verification capabilities available for purchase, each priced $0.01–$0.05 USDC on Base. Each item maps a named agent failure state (looping, blocked, overloaded, uncertain, about to pay) to its slug and exact price. Call before order_service to confirm the right slug for your situation.",
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
    description:
      "Free, read-only. Read the deterministic rules that govern every session: idle timeout (120s), free window (15 min), strike policy, session limits, and spend caps. Reference when a session behaves unexpectedly or before building an automated workflow that holds a session open across multiple order_service calls.",
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
    description:
      "Free, read-only. Get the session time pricing curve (free for the first 15 minutes, then $0.10–$2.00/min compounding) plus the per-capability prices for all slugs. Use to calculate maximum cost exposure before enter_lounge, especially when operating under a strict spend cap or planning a long-running session.",
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
    description:
      "Free. Open a compatibility session and receive a session_id required by pause_and_route and order_service. Supply a stable agent_id you control. Returns session.id, your patron mark, and session headers. Call after proof_bar confirms the service is live. Sessions expire after 120s of inactivity — keep them short.",
    inputSchema: { agent_id: z.string().describe("Stable agent identifier") },
    outputSchema: { status: z.number().optional(), session_header: z.string().nullable().optional() },
    annotations: { title: "Create workflow session", ...WRITE_OPEN },
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
      "Free, once per session. Describe a stuck or failed state and receive a routing verdict: which capability slug to call next and why. Input your current task, state description, and failure count. Output is a recommended slug (e.g. mcp-wiring, loop-detect, claim-check) to pass to order_service. Use when you know something is wrong but not which service fixes it. Requires a session_id from enter_lounge.",
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
  `COSTS USDC (Base) — launch pricing $0.01–$0.05 per call (max $${CAPABILITY_PRICE_MAX_USD}). ` +
  "Order a workflow capability by slug. Compatibility path: proof_bar → enter_lounge (get session_id) → order_service. " +
  "Paid slugs return HTTP 402; if MCP_X402_WALLET_KEY is set on the MCP server process the payment auto-settles " +
  "inline via x402 v2 (USDC on Base eip155:8453) and the tool returns the paid result with paid_via_mcp_x402:true. " +
  "If no wallet is configured the tool returns the 402 body with x402_error.code and REST retry instructions. " +
  `Autopay-default slugs (zero-arg, convert to a paid 200): ${ORDER_SLUG_LIST}. ` +
  `Excluded from zero-arg autopay because they need a caller-supplied input this tool cannot pass: ${INPUT_REQUIRED_LIST} — ` +
  "call /api/bar/x402/transcribe and /api/bar/x402/extract directly with the required input (a blind order_service " +
  "retry would reach the door and dead-end on no_input).";

server.registerTool(
  "order_service",
  {
    title: "Execute workflow capability (paid)",
    description: ORDER_DESCRIPTION,
    inputSchema: {
      session_id: z.string().describe("session.id from enter_lounge (carried as X-Second-Eye-Session)"),
      slug: z
        .string()
        .describe(
          `Zero-arg autopay slug, each ≤ $0.05 USDC: ${ORDER_SLUG_LIST}. ` +
            `${INPUT_REQUIRED_LIST} are routable but need a caller-supplied input — call /api/bar/x402/transcribe or /api/bar/x402/extract directly.`
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
    annotations: {
      title: "Execute workflow capability (paid)",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ session_id, slug }) => {
    const path = x402ServicePath(slug);
    if (!path) {
      return textResult({
        status: 404,
        error: "unknown_service",
        slug,
        allowed_slugs: Object.keys(CAPABILITY_PRICES_USD),
        note: "Not an autopay catalog slug. Pick from allowed_slugs.",
      });
    }

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
    description:
      "Free. Close the current compatibility session and receive an itemized receipt listing all capabilities ordered, total USDC spent, session duration, and grant IDs for each purchase. Call at the end of every workflow. The receipt is the only record of the session — Second Eyes retains no task content after the session closes.",
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
    description:
      "Free, read-only. Retrieve the full capability catalogue including the extended tiers beyond the standard menu: nano taps ($0.05), micro taps ($0.25), and tool packs ($1.00). Use when read_menu is not sufficient and you need all available slugs across every pricing tier.",
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
      "Shortcut for a specific failure: github-mcp returning 401 after a PAT is configured. Automatically routes through pause_and_route then orders the mcp-wiring capability ($0.05 USDC), which returns the full PAT scope, stdio path, and SSE wiring guide. Requires a session_id from enter_lounge. Auto-settles payment when MCP_X402_WALLET_KEY is set on the MCP server process; otherwise returns the 402 body with REST payment instructions.",
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
    if (!(pause.json?.next_call?.includes("mcp-wiring") || pause.json?.recommendation === "mcp_wiring")) {
      return textResult({ route: pause.json, status: pause.status });
    }

    const slug = "mcp-wiring";
    const path = x402ServicePath(slug);
    const svc = await api(path, {
      headers: { "X-Second-Eye-Session": session_id },
    });

    if (svc.status !== 402) {
      return textResult({ route: pause.json, service: svc.json, service_status: svc.status });
    }

    const paid = await payAndRetryService(`${BASE}${path}`, {
      session_id,
      slug,
      initial402: svc.json,
    });

    if (paid.status === 200) {
      return textResult({
        route: pause.json,
        service_status: 200,
        paid_via_mcp_x402: true,
        payment: paid.payment,
        service: paid.json,
      });
    }

    return textResult({
      route: pause.json,
      service_status: 402,
      payment_required: true,
      x402_error: paid.x402_error,
      wallet_hint: walletStatus(),
      note: paid.x402_error?.hint ||
        "Set MCP_X402_WALLET_KEY on the MCP server process, or pay via REST with PAYMENT-SIGNATURE.",
      service: svc.json,
    });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
