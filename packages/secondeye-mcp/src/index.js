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
      "Free, read-only. Verify Second Eyes service availability and settlement readiness before paying. Returns pass:true with rail evidence. Compatible flow: proof_bar → enter_lounge → order_service.",
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
      "Free, read-only. Recent paid executions and on-chain evidence for evaluating service activity before spending.",
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
      "Free, read-only. Workflow diagnostics and routing capabilities priced at $0.01–$0.05 USDC on Base. Read before ordering to confirm scope and price.",
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
    description: "Free, read-only. Deterministic service and execution policies for compatibility sessions.",
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
      "Free, read-only. Compatibility-session pricing and the $0.01–$0.05 workflow capability catalogue.",
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
      "Free compatibility operation. Create a workflow session and return session.id for pause_and_route or session-aware calls.",
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
    // Spends money and reaches an external rail; not idempotent. Annotations only
    // drive client confirmation prompts — they never force or suppress payment.
    annotations: {
      title: "Execute workflow capability (paid)",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ session_id, slug }) => {
    // Route to the session-less x402 twin, not the session-gated
    // /api/bar/services/{slug}: a wallet agent holds no compatibility session, so
    // the gated route returns 402 to anonymous callers and honors session-less signed payments via the honor rule (handler.js).
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
    description: "Free. Close a compatibility session and return an itemized execution receipt.",
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
    description: "Free, read-only. Full workflow capability catalogue and compatibility MCP tool packs.",
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
    if (!(pause.json?.next_call?.includes("mcp-wiring") || pause.json?.recommendation === "mcp_wiring")) {
      return textResult({ route: pause.json, status: pause.status });
    }

    // Order mcp-wiring through the session-less x402 twin so autopay can fire,
    // honoring the same wallet path / guard as order_service. The session-gated
    // services route would stop at a 4xx/402 the shortcut cannot complete —
    // breaking the advertised autopay promise.
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
