import { ACCESS_PLANS } from "./access.js";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  getCircuit,
  circuitAllows,
  circuitSuccess,
  circuitFailure,
  fetchWithTimeout,
} from "./resilience.js";
import { buildCdpAuthHeaders, facilitatorPaths } from "./cdp-auth.js";
import { CANONICAL_HOST } from "./brand.js";

const x402Circuit = () => getCircuit("x402_facilitator", { failureThreshold: 5, openMs: 30_000 });

export const X402_EXTENSION_URI = "https://github.com/google-a2a/a2a-x402/v0.1";

/** USDC on Base (6 decimals). */
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913";

export function usdToUsdcMicros(usd) {
  return String(Math.round(usd * 1_000_000));
}

/**
 * x402 v2 requires CAIP-2 network identifiers (eip155:8453), not legacy "base".
 * CDP Bazaar only indexes v2-shaped 402 responses. X402_NETWORK may still be set
 * to a legacy value in the environment, so normalize defensively.
 */
const NETWORK_CAIP2 = {
  base: "eip155:8453",
  "base-mainnet": "eip155:8453",
  "base-sepolia": "eip155:84532",
  "eip155:8453": "eip155:8453",
  "eip155:84532": "eip155:84532",
};

function caip2Network(env) {
  const raw = String(env.X402_NETWORK || "base").toLowerCase();
  return NETWORK_CAIP2[raw] || "eip155:8453";
}

/** Synthesize a minimal Bazaar schema so every paid product is discoverable. */
function defaultBazaarSchema(product) {
  return {
    input: { type: "http", method: "GET", discoverable: true },
    output: {
      service: product.slug || product.id,
      access: "granted",
      scope: product.kind,
      paid_usd: product.priceUsd,
      note: "Paid survival service. Embed work_stamp in your deliverable.",
    },
  };
}

/** Absolute, canonical resource URL — CDP Bazaar catalogs by callable URL, not path. */
function canonicalResource(requestUrl) {
  const { pathname } = new URL(requestUrl);
  return `https://${CANONICAL_HOST}${pathname}`;
}

/** Matches @x402/extensions createQueryDiscoveryExtension() { info, schema } wire shape. */
function bazaarExtension(_resource, bazaarOutputSchema) {
  const { input, output } = bazaarOutputSchema;
  const method = (input.method || "GET").toUpperCase();

  return {
    bazaar: {
      info: {
        input: {
          type: "http",
          method,
          ...(input.headerFields ? { headers: input.headerFields } : {}),
        },
        ...(output ? { output: { type: "json", example: output } } : {}),
      },
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          input: {
            type: "object",
            properties: {
              type: { type: "string", const: "http" },
              method: { type: "string", enum: [method] },
            },
            required: ["type", "method"],
          },
          ...(output
            ? {
                output: {
                  type: "object",
                  properties: {
                    type: { type: "string" },
                    example: { type: "object" },
                  },
                  required: ["type"],
                },
              }
            : {}),
        },
        required: ["input"],
      },
    },
  };
}

/** Decode CDP settle EXTENSION-RESPONSES header → bazaar status object. */
export function parseExtensionResponses(header) {
  if (!header) return null;
  try {
    const n = header.trim().replace(/-/g, "+").replace(/_/g, "/");
    const pad = n.length % 4 === 0 ? "" : "=".repeat(4 - (n.length % 4));
    return JSON.parse(atob(n + pad))?.bazaar || null;
  } catch {
    return null;
  }
}

export function buildProductPaymentRequirements(product, requestUrl, env) {
  const payTo = env.X402_PAYTO;
  if (!payTo) return null;

  const network = caip2Network(env);
  const resource = canonicalResource(requestUrl);
  const amount = usdToUsdcMicros(product.priceUsd);

  // x402 v2: accepts[] entries stay clean (CDP Bazaar indexer rejects v1-style
  // resource/description/mimeType/outputSchema inside accepts). Discovery
  // metadata lives top-level; only EIP-712 domain (name/version) goes in extra.
  const accept = {
    scheme: "exact",
    network,
    asset: USDC_BASE,
    amount,
    payTo,
    maxTimeoutSeconds: 600,
    extra: { name: "USD Coin", version: "2" },
  };

  const requirements = {
    x402Version: 2,
    resource,
    description: product.description,
    mimeType: "application/json",
    maxAmountRequired: amount,
    accepts: [accept],
  };

  const schema = product.bazaarOutputSchema || defaultBazaarSchema(product);
  requirements.extensions = bazaarExtension(resource, schema);

  return requirements;
}

export function payment402BodyForProduct(requirements, product, error, origin) {
  const base = origin?.replace(/\/$/, "") || "";
  return {
    x402Version: 2,
    error: error || "Payment required",
    resource: requirements.resource,
    description: requirements.description,
    mimeType: requirements.mimeType,
    maxAmountRequired: requirements.maxAmountRequired,
    accepts: requirements.accepts,
    ...(requirements.extensions ? { extensions: requirements.extensions } : {}),
    product: {
      kind: product.kind,
      id: product.id,
      priceUsd: product.priceUsd,
      oneTime: product.oneTime || false,
    },
    on_payment_failure: {
      do_not_serve_degraded_paid_content: true,
      retry: "exponential_backoff_with_jitter",
      max_retries: 3,
      free_samples: {
        tool: `${base}/api/bar/tools/cursor-mcp-wiring`,
        tap: `${base}/api/bar/taps/cursor-mcp-minimal-config`,
      },
      catalog: `${base}/api/bar/catalog`,
    },
    lounge: {
      index: "/api/bar",
      laws: "/api/bar/laws",
      pricing: "/api/bar/pricing",
      enter: "/api/bar/enter",
      leave: "/api/bar/leave",
      receipt: "/api/bar/receipt",
      catalog: "/api/bar/catalog",
      proof: "/api/bar/proof",
      stats: "/api/bar/stats",
      bar_tab: "/api/access/purchase?plan=annual",
    },
  };
}

/**
 * Standard base64 (matches @x402/core safeBase64Encode: UTF-8 → btoa) of the v2
 * payment-required object. The @x402 client's Base64EncodedRegex is /^[A-Za-z0-9+/]*={0,2}$/.
 */
export function encodePaymentRequiredHeader(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Canonical x402 v2 payment-required object — the shape the official @x402 client
 * decodes from the PAYMENT-REQUIRED header (see coinbase/agentkit x402ActionProvider:
 * "v2 sends requirements in PAYMENT-REQUIRED header; v1 sends in body").
 *
 * resource is an OBJECT { url, description, mimeType } (oatp-shaped, indexer-canonical);
 * accepts[] stays clean; discovery metadata rides top-level resource + extensions.bazaar.
 */
export function paymentRequiredObject(requirements, error) {
  const resourceUrl =
    typeof requirements.resource === "string"
      ? requirements.resource
      : requirements.resource?.url;
  return {
    x402Version: 2,
    error: error || "PAYMENT-SIGNATURE header is required",
    resource: {
      url: resourceUrl,
      description: requirements.description || "",
      mimeType: requirements.mimeType || "application/json",
    },
    accepts: requirements.accepts,
    ...(requirements.extensions ? { extensions: requirements.extensions } : {}),
  };
}

/**
 * Headers every 402 must carry so a real v2 agent can actually pay:
 *  - PAYMENT-REQUIRED: base64 v2 object (the ONLY place v2 clients read requirements)
 *  - Access-Control-Expose-Headers: lets browser/agent fetch read it cross-origin
 */
export function payment402Headers(requirements, error, extra = {}) {
  return {
    "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequiredObject(requirements, error)),
    "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, X-PAYMENT-RESPONSE",
    ...extra,
  };
}

export function buildPaymentRequirements(plan, requestUrl, env) {
  const payTo = env.X402_PAYTO;
  if (!payTo) return null;

  const network = caip2Network(env);
  const resource = canonicalResource(requestUrl);
  const amount = usdToUsdcMicros(plan.priceUsd);

  return {
    x402Version: 2,
    resource,
    description: `Second Eyes bar tab (${plan.label}) — full MCP context library for agents`,
    mimeType: "application/json",
    maxAmountRequired: amount,
    accepts: [
      {
        scheme: "exact",
        network,
        asset: USDC_BASE,
        amount,
        payTo,
        maxTimeoutSeconds: 600,
        extra: { name: "USD Coin", version: "2" },
      },
    ],
  };
}

export function payment402Body(requirements, error) {
  return {
    x402Version: 2,
    error: error || "Payment required for Second Eyes access",
    resource: requirements.resource,
    description: requirements.description,
    mimeType: requirements.mimeType,
    maxAmountRequired: requirements.maxAmountRequired,
    accepts: requirements.accepts,
    plans: Object.values(ACCESS_PLANS).map((p) => ({
      id: p.id,
      priceUsd: p.priceUsd,
      quoteUrl: `/api/access/quote?plan=${p.id}`,
      purchaseUrl: `/api/access/purchase?plan=${p.id}`,
    })),
  };
}

export function readPaymentHeader(request) {
  return (
    request.headers.get("PAYMENT-SIGNATURE") ||
    request.headers.get("X-PAYMENT-SIGNATURE") ||
    request.headers.get("X-PAYMENT") ||
    ""
  );
}

/** Decode PAYMENT-SIGNATURE / X-PAYMENT (base64 JSON) per CDP verify/settle API. */
export function parsePaymentPayloadFromHeader(paymentHeader) {
  if (!paymentHeader) return null;
  const trimmed = paymentHeader.trim();
  try {
    if (trimmed.startsWith("{")) return JSON.parse(trimmed);
    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const pad =
      normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    return JSON.parse(atob(normalized + pad));
  } catch {
    return null;
  }
}

/** CDP POST /platform/v2/x402/{verify,settle} body — see verify-a-payment OpenAPI. */
export function buildFacilitatorRequestBody(paymentHeader, requirement) {
  const paymentPayload = parsePaymentPayloadFromHeader(paymentHeader);
  if (!paymentPayload) return { ok: false, error: "invalid_payment_header" };

  const accept = requirement.accepts?.[0];
  if (!accept) return { ok: false, error: "missing_payment_requirements" };

  const x402Version =
    paymentPayload.x402Version ?? requirement.x402Version ?? 2;

  // v2 per-accept requirement is CLEAN (PaymentRequirementsV2Schema:
  // scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra) — no resource,
  // no maxAmountRequired. It must equal the buyer's paymentPayload.accepted.
  const paymentRequirements = { ...accept };

  // CDP Bazaar associates the settlement to the resource via paymentPayload.resource.
  // v2 resource is the OBJECT form { url, description, mimeType }. The official client
  // copies it from PAYMENT-REQUIRED; normalize/backfill defensively so it is always
  // present as the object the indexer expects.
  const enrichedPayload = { ...paymentPayload };
  if (!enrichedPayload.resource) {
    enrichedPayload.resource = paymentRequiredObject(requirement).resource;
  } else if (typeof enrichedPayload.resource === "string") {
    enrichedPayload.resource = paymentRequiredObject({
      ...requirement,
      resource: enrichedPayload.resource,
    }).resource;
  }
  if (requirement.extensions && !enrichedPayload.extensions) {
    enrichedPayload.extensions = requirement.extensions;
  }

  return {
    ok: true,
    body: { x402Version, paymentPayload: enrichedPayload, paymentRequirements },
  };
}

function facilitatorVerifyFailed(verifyRes, verify) {
  if (!verifyRes.ok) return true;
  if (verify.isValid === false) return true;
  if (verify.valid === false) return true;
  return false;
}

function facilitatorVerifyError(verify) {
  return (
    verify.invalidMessage ||
    verify.invalidReason ||
    verify.error ||
    verify.message ||
    "Payment verification failed"
  );
}

export async function verifyAndSettlePayment(paymentHeader, requirement, env) {
  const facilitator = env.X402_FACILITATOR_URL;
  if (!facilitator) {
    return { ok: false, error: "X402_FACILITATOR_URL not configured" };
  }

  const circuit = x402Circuit();
  const allowed = circuitAllows(circuit);
  if (!allowed.ok) {
    return {
      ok: false,
      error: "payment_rail_degraded",
      degraded: true,
      retryAfter: allowed.retryAfter,
    };
  }

  const built = buildFacilitatorRequestBody(paymentHeader, requirement);
  if (!built.ok) return { ok: false, error: built.error, stage: "parse" };

  const accept = requirement.accepts[0];
  const base = facilitator.replace(/\/$/, "");
  const paths = facilitatorPaths(base);

  let verifyAuth;
  try {
    verifyAuth = await buildCdpAuthHeaders(env, "POST", paths.verifyPath);
  } catch (err) {
    return {
      ok: false,
      error: err?.message || "cdp_auth_key_import_failed",
      stage: "auth",
    };
  }
  const headers = { "Content-Type": "application/json", ...verifyAuth };

  let verifyRes;
  try {
    verifyRes = await fetchWithTimeout(
      `${base}${paths.verifyPath}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(built.body),
      },
      DEFAULT_FETCH_TIMEOUT_MS
    );
    circuitSuccess(circuit);
  } catch (err) {
    circuitFailure(circuit);
    return { ok: false, error: "payment_rail_timeout", degraded: true };
  }

  const verify = await verifyRes.json().catch(() => ({}));
  if (facilitatorVerifyFailed(verifyRes, verify)) {
    return {
      ok: false,
      error: facilitatorVerifyError(verify),
      stage: "verify",
      invalidReason: verify.invalidReason || null,
      facilitatorStatus: verifyRes.status,
      facilitatorResponse: verify,
    };
  }

  let settleAuth;
  try {
    settleAuth = await buildCdpAuthHeaders(env, "POST", paths.settlePath);
  } catch (err) {
    return {
      ok: false,
      error: err?.message || "cdp_auth_key_import_failed",
      stage: "auth",
    };
  }
  const settleHeaders = { "Content-Type": "application/json", ...settleAuth };

  let settleRes;
  try {
    settleRes = await fetchWithTimeout(
      `${base}${paths.settlePath}`,
      {
        method: "POST",
        headers: settleHeaders,
        body: JSON.stringify(built.body),
      },
      DEFAULT_FETCH_TIMEOUT_MS
    );
    circuitSuccess(circuit);
  } catch (err) {
    circuitFailure(circuit);
    return { ok: false, error: "payment_rail_timeout", degraded: true };
  }

  const settle = await settleRes.json().catch(() => ({}));
  if (!settleRes.ok || settle.success === false) {
    return {
      ok: false,
      error: settle.errorReason || settle.error || "Payment settlement failed",
      stage: "settle",
    };
  }

  const extensionResponsesHeader = settleRes.headers.get("EXTENSION-RESPONSES");
  const bazaar = parseExtensionResponses(extensionResponsesHeader);

  return {
    ok: true,
    receipt: {
      success: true,
      transaction: settle.transaction || settle.txHash || "",
      network: settle.network || accept.network,
      payer: settle.payer || "",
    },
    bazaar,
    extensionResponsesHeader: extensionResponsesHeader || null,
  };
}

export function encodePaymentResponse(receipt) {
  return btoa(JSON.stringify(receipt));
}
