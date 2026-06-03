/** Minimal streamable-HTTP MCP facade for registry scanners (Smithery, etc.). Full tools via stdio npm package. */

import { SERVICE_PRICES } from "./lounge/constants.js";
import { buildServicePayload } from "./lounge/services.js";
import {
  buildProductPaymentRequirements,
  paymentRequiredObject,
  verifyAndSettlePayment,
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
  version: "1.0.5",
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
        version: "1.0.5",
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

/** MCP error code carrying x402 payment requirements (mirrors HTTP 402). */
const MCP_PAYMENT_REQUIRED_CODE = -32402;

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
 * Paid MCP tool over _meta["x402/payment"]. Unpaid tools/call → MCP error carrying
 * the v2 PaymentRequired object (the MCP analogue of HTTP 402 + PAYMENT-REQUIRED).
 * Paid retry: the client puts its signed payment under _meta["x402/payment"]; we
 * verify+settle through the same CDP path as HTTP/A2A and return the receipt.
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

  // Unpaid: return the requirements so the client can sign and retry.
  if (!paymentEntry) {
    return {
      status: 200,
      payload: rpcError(id, MCP_PAYMENT_REQUIRED_CODE, "Payment required", {
        [MCP_X402_META_KEY]: {
          status: "payment-required",
          accepts: requirements.accepts,
          ...paymentRequiredObject(requirements, "Payment required"),
          extensions: requirements.extensions,
          instructions:
            "Sign an x402 ExactEvmScheme payment for accepts[0] and retry tools/call with " +
            `_meta["${MCP_X402_META_KEY}"].payload set to the base64 PAYMENT-SIGNATURE value.`,
        },
      }),
    };
  }

  // Paid retry: settle the signed payment.
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

  const settled = await verifyAndSettlePayment(paymentHeader, requirements, env, {
    transport: "mcp",
    tool: name,
    slug,
  });

  if (!settled.ok) {
    return {
      status: 200,
      payload: rpcError(id, MCP_PAYMENT_REQUIRED_CODE, settled.error || "Payment failed", {
        [MCP_X402_META_KEY]: { status: "payment-failed", stage: settled.stage || null, error: settled.error },
      }),
    };
  }

  return {
    status: 200,
    payload: rpc(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { ...(buildServicePayload(slug, origin) || {}), service: slug, access: "granted", receipt: settled.receipt },
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
