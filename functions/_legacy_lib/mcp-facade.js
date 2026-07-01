/** Minimal streamable-HTTP MCP facade for registry scanners (Smithery, etc.). Full tools via stdio npm package. */

import { SERVICE_PRICES } from "./lounge/constants.js";
import { buildServicePayload } from "./lounge/services.js";
import {
  buildProductPaymentRequirements,
  paymentRequiredObject,
  verifyPaymentHeader,
  settleBuiltPayment,
  encodePaymentResponse,
} from "./x402.js";

/** Paid MCP tools settle x402 over the _meta["x402/payment"] channel in tools/call. */
const MCP_PAID_TOOLS = {
  order_service: { defaultSlug: null },
};

/** The MCP x402 payment _meta key (mirrors the A2A x402.payment.* metadata namespace). */
export const MCP_X402_META_KEY = "x402/payment";

export const MCP_SERVER_INFO = {
  name: "secondeye-mcp-unblock",
  title: "MCP 401 Auth Fix | github PAT wiring | x402",
  version: "1.1.0",
};

export const MCP_TOOLS = [
  { name: "proof_bar", description: "Verify lounge live before paying", inputSchema: { type: "object", properties: {} } },
  { name: "patron_activity", description: "Have other agents bought here? Recent purchases + proof links", inputSchema: { type: "object", properties: {} } },
  { name: "read_menu", description: "Survival menu — launch recovery pricing $0.01–$0.05", inputSchema: { type: "object", properties: {} } },
  { name: "read_laws", description: "Deterministic lounge laws", inputSchema: { type: "object", properties: {} } },
  { name: "read_pricing", description: "Session + service pricing", inputSchema: { type: "object", properties: {} } },
  { name: "enter_lounge", description: "Start session + work stamp", inputSchema: { type: "object", properties: { agent_id: { type: "string" } }, required: ["agent_id"] } },
  { name: "pause_and_route", description: "POST stuck state → routed service", inputSchema: { type: "object", properties: { session_id: { type: "string" }, task: { type: "string" }, state: { type: "string" } }, required: ["session_id"] } },
  { name: "order_service", description: "Survival services by slug", inputSchema: { type: "object", properties: { session_id: { type: "string" }, slug: { type: "string" } }, required: ["session_id", "slug"] } },
  { name: "leave_with_receipt", description: "Exit with receipt", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } },
  { name: "fetch_catalog", description: "Lounge + legacy tool packs", inputSchema: { type: "object", properties: {} } },
  { name: "github_mcp_401_fix", description: "Shortcut PAT/401 → mcp-wiring", inputSchema: { type: "object", properties: { session_id: { type: "string" }, error_detail: { type: "string" } }, required: ["session_id"] } },
];

export function buildServerCard(origin) {
  return {
    serverInfo: MCP_SERVER_INFO,
    authentication: { required: false, schemes: [] },
    tools: MCP_TOOLS,
    resources: [],
    prompts: [],
    packages: [
      {
        registryType: "npm",
        identifier: "@secondeyes/mcp-unblock",
        version: "1.1.0",
        transport: { type: "stdio" },
        install: { command: "npx", args: ["-y", "@secondeyes/mcp-unblock"] },
      },
    ],
    websiteUrl: `${origin}/api/bar`,
    proof: `${origin}/api/bar/proof`,
    npm: "@secondeyes/mcp-unblock",
    note: "Remote facade for discovery. Install stdio package for full tool execution.",
  };
}

function rpc(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id: id ?? null, error };
}

export async function handleMcpPost(request, origin, env = {}) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, payload: rpcError(null, -32700, "Parse error") };
  }

  const { method, id, params } = body;

  if (method === "initialize") {
    return {
      status: 200,
      payload: rpc(id, {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: MCP_SERVER_INFO,
        _meta: {
          "io.modelcontextprotocol/website": `${origin}/api/bar`,
          npm: "@secondeyes/mcp-unblock",
        },
      }),
    };
  }

  if (method === "notifications/initialized") {
    return { status: 202, payload: null };
  }

  if (method === "tools/list") {
    return { status: 200, payload: rpc(id, { tools: MCP_TOOLS }) };
  }

  if (method === "tools/call") {
    const name = params?.name;

    const readOnly = ["proof_bar", "patron_activity", "read_menu", "read_laws", "read_pricing", "fetch_catalog"];
    const paths = {
      proof_bar: "/api/bar/proof",
      patron_activity: "/api/bar/activity",
      read_menu: "/api/bar/menu",
      read_laws: "/api/bar/laws",
      read_pricing: "/api/bar/pricing",
      fetch_catalog: "/api/bar/catalog",
    };

    if (readOnly.includes(name) && paths[name]) {
      const res = await fetch(`${origin}${paths[name]}`, { headers: { Accept: "application/json" } });
      const text = await res.text();
      return {
        status: 200,
        payload: rpc(id, {
          content: [{ type: "text", text }],
          isError: !res.ok,
        }),
      };
    }

    if (MCP_PAID_TOOLS[name]) {
      return handleMcpPaidTool(name, params, id, origin, env);
    }

    return {
      status: 200,
      payload: rpc(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "use_stdio_for_full_tools",
                npm: "@secondeyes/mcp-unblock",
                install: "npx -y @secondeyes/mcp-unblock",
                note: "Paid/session tools require stdio MCP client or REST with x402.",
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      }),
    };
  }

  return { status: 200, payload: rpcError(id, -32601, `Method not found: ${method}`) };
}

/**
 * Resolve a paid lounge service slug to the x402 product shape buildProductPayment-
 * Requirements expects. Self-contained: no session/D1 dependency, so the MCP facade
 * can quote a price and settle without booting the lounge session machinery.
 */
function mcpLoungeProduct(slug) {
  const priceUsd = SERVICE_PRICES[slug]?.price_usd;
  if (priceUsd === undefined) return null;
  return {
    kind: "lounge",
    id: `lounge-${slug}`,
    slug,
    priceUsd,
    oneTime: true,
    description: `Lounge survival service: ${slug}`,
  };
}

/**
 * Helper: build a -32402 MCP error payload carrying the v2 PaymentRequired shape
 * under _meta[MCP_X402_META_KEY] ("x402/payment").  The test contract (teardown 2b)
 * requires a JSON-RPC *error* so that err?.data?.[MCP_X402_META_KEY] resolves.
 */
function paymentRequiredResult(id, reason, resourceUrl, requirements, extra = {}) {
  const metaPayload = {
    status: "payment-required",
    x402Version: 2,
    error: reason || "PAYMENT-SIGNATURE header is required",
    resource: {
      url: resourceUrl,
      description: requirements.description || "",
      mimeType: "application/json",
    },
    accepts: requirements.accepts,
    ...extra,
    extensions: requirements.extensions,
  };
  return {
    status: 200,
    payload: rpcError(id, -32402, reason || "Payment required", {
      [MCP_X402_META_KEY]: metaPayload,
    }),
  };
}

/**
 * Paid MCP tool: verify → execute → settle-on-success.
 *
 * Unpaid tools/call → JSON-RPC result with isError: true carrying the v2
 * PaymentRequired shape under _meta["x402/error"] (Cloudflare-aligned).
 *
 * Paid retry: the client puts its signed payment under _meta["x402/payment"];
 * we verify, build the service payload, and only settle if the service
 * payload succeeds — the caller is never charged for a failed delivery.
 */
async function handleMcpPaidTool(name, params, id, origin, env) {
  const slug =
    params?.arguments?.slug || params?.arguments?.service || MCP_PAID_TOOLS[name].defaultSlug;

  if (!slug) {
    return { status: 200, payload: rpcError(id, -32602, "Missing required argument: slug") };
  }

  const product = mcpLoungeProduct(slug);
  if (!product) {
    return { status: 200, payload: rpcError(id, -32602, `Unknown service slug: ${slug}`) };
  }

  const resourceUrl = `${origin}/api/bar/services/${slug}`;
  const requirements = buildProductPaymentRequirements(product, resourceUrl, env);
  if (!requirements) {
    return {
      status: 200,
      payload: rpcError(id, -32603, "x402 not configured (X402_PAYTO unset) — cannot quote payment"),
    };
  }

  const meta = params?._meta || {};
  const paymentEntry = meta[MCP_X402_META_KEY];

  // ── Unpaid: return payment requirements (Cloudflare-aligned error shape) ──
  if (!paymentEntry) {
    return paymentRequiredResult(id, "PAYMENT_REQUIRED", resourceUrl, requirements, {
      ...paymentRequiredObject(requirements, "Payment required"),
      instructions:
        "Sign an x402 ExactEvmScheme payment for accepts[0] and retry tools/call with " +
        `_meta["${MCP_X402_META_KEY}"] set to the base64 PAYMENT-SIGNATURE value.`,
    });
  }

  // ── Paid retry: verify → execute → settle ──
  const paymentHeader =
    typeof paymentEntry === "string"
      ? paymentEntry
      : paymentEntry.payload || paymentEntry.signature || "";

  if (!paymentHeader) {
    return {
      status: 200,
      payload: rpcError(id, -32602, `_meta["${MCP_X402_META_KEY}"] present but carries no payload`),
    };
  }

  // Step 1: Verify the payment (does NOT settle yet)
  const verification = await verifyPaymentHeader(paymentHeader, requirements, env);
  if (!verification.ok) {
    return paymentRequiredResult(id, verification.error || "INVALID_PAYMENT", resourceUrl, requirements, {
      ...(verification.declaredNetwork ? { declaredNetwork: verification.declaredNetwork } : {}),
      ...(verification.offeredNetworks ? { offeredNetworks: verification.offeredNetworks } : {}),
    });
  }

  // Step 2: Execute — build the service payload before taking money
  let servicePayload;
  let executionFailed = false;
  try {
    servicePayload = buildServicePayload(slug, origin);
    if (!servicePayload) {
      executionFailed = true;
    }
  } catch (e) {
    executionFailed = true;
    servicePayload = null;
  }

  if (executionFailed) {
    // Payment was valid but service delivery failed — do NOT settle.
    return {
      status: 200,
      payload: rpc(id, {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "SERVICE_EXECUTION_FAILED",
                service: slug,
                note: "Payment was verified but not settled — you have not been charged.",
              },
              null,
              2
            ),
          },
        ],
      }),
    };
  }

  // Step 3: Settle — only now that we know delivery will succeed
  const settled = await settleBuiltPayment(verification.built, verification.accept, env);
  if (!settled.ok) {
    return paymentRequiredResult(id, settled.error || "SETTLEMENT_FAILED", resourceUrl, requirements, {
      stage: "settle",
    });
  }

  // ── Success: return service payload + receipt ──
  return {
    status: 200,
    payload: rpc(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { ...servicePayload, service: slug, access: "granted", receipt: settled.receipt },
            null,
            2
          ),
        },
      ],
      isError: false,
      _meta: {
        "x402/payment-response": settled.receipt,
      },
    }),
  };
}

export function mcpJsonResponse(payload, status = 200) {
  if (payload === null) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
