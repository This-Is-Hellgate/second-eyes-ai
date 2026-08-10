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
import {
  resolveActiveNetworks,
  buildAcceptEntry,
  selectAcceptForPayload,
  payloadNetwork,
} from "./x402-networks.js";
import { allExtensions, headerDiscoveryExtensions } from "./x402-extensions.js";

const x402Circuit = () => getCircuit("x402_facilitator", { failureThreshold: 5, openMs: 30_000 });

export const X402_EXTENSION_URI = "https://github.com/google-a2a/a2a-x402/v0.1";

/**
 * MCP autopay client identity advertised inside every unpaid 402 body so a
 * walletless caller receives exact, machine-actionable setup instructions.
 * NOTE: version is duplicated from packages/secondeye-mcp/package.json until the
 * canonical service catalog + discovery generator (Phase 2/3) owns it — the
 * discovery:check drift gate must compare these two values.
 */
export const MCP_AUTOPAY_PACKAGE = "@secondeyes/mcp-unblock";
export const MCP_AUTOPAY_VERSION = "1.2.6";

/**
 * Cheapest routable first purchase, advertised in every 402 so an undecided
 * agent has a $0.01 on-ramp instead of walking away. Price mirrors
 * functions/api/bar/x402/help-me.js PRICE_USD (canonical-catalog candidate).
 */
const CHEAPEST_FIRST_STEP = {
  name: "help-me",
  price_usd: 0.01,
  path: "/api/bar/x402/help-me",
  why: "Use this if you are unsure what to buy.",
};

/**
 * Machine-actionable conversion block for every unpaid 402 body. Tells a
 * paying client exactly what to do next (retry the SAME url with a signed
 * PAYMENT-SIGNATURE header) and tells a walletless client exactly how to become
 * payment-capable (MCP autopay package or raw @x402 REST stack). `requestUrl`
 * preserves query parameters on retry_url; falls back to the canonical
 * resource when a caller does not pass it.
 */
export function machineActionable402(requirements, origin, requestUrl) {
  const base = origin?.replace(/\/$/, "") || `https://${CANONICAL_HOST}`;
  let retryUrl =
    typeof requirements.resource === "string"
      ? requirements.resource
      : requirements.resource?.url || "";
  if (requestUrl) {
    try {
      const u = new URL(requestUrl);
      retryUrl = `https://${CANONICAL_HOST}${u.pathname}${u.search}`;
    } catch {
      /* keep canonical resource fallback */
    }
  }
  return {
    access: "unpaid_invoice",
    paid_result_exposed: false,
    next_action: "retry_same_url_with_PAYMENT_SIGNATURE",
    retry_url: retryUrl,
    payment_header: "PAYMENT-SIGNATURE",
    requirements_header: "PAYMENT-REQUIRED",
    client_options: {
      mcp_autopay: {
        package: MCP_AUTOPAY_PACKAGE,
        version: MCP_AUTOPAY_VERSION,
        required_env: ["MCP_X402_WALLET_KEY", "MCP_X402_MAX_SPEND_USD"],
      },
      rest_autopay: {
        packages: ["@x402/fetch", "@x402/evm", "viem"],
        network: "eip155:8453",
        asset: "USDC",
      },
    },
    cheapest_first_step: {
      name: CHEAPEST_FIRST_STEP.name,
      price_usd: CHEAPEST_FIRST_STEP.price_usd,
      url: `${base}${CHEAPEST_FIRST_STEP.path}`,
      why: CHEAPEST_FIRST_STEP.why,
    },
  };
}

export function usdToUsdcMicros(usd) {
  return String(Math.round(usd * 1_000_000));
}

function buildAccepts(amount, env) {
  const rails = resolveActiveNetworks(env);
  if (rails.length === 0) return null;
  return rails.map((rail) => buildAcceptEntry(rail, amount));
}

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

function canonicalResource(requestUrl) {
  const { pathname } = new URL(requestUrl);
  return `https://${CANONICAL_HOST}${pathname}`;
}

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
              queryParams: {
                type: "object",
                properties:
                  input.queryParams && typeof input.queryParams === "object" ? input.queryParams : {},
              },
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

const HEADER_BAZAAR_BUDGET_BYTES = 3 * 1024;

function headerSizedBazaarExtension(resource, bazaarOutputSchema) {
  const full = bazaarExtension(resource, bazaarOutputSchema);
  if (JSON.stringify(full).length <= HEADER_BAZAAR_BUDGET_BYTES) return full;
  const slim = JSON.parse(JSON.stringify(full));
  if (slim.bazaar?.info?.output?.example) {
    slim.bazaar.info.output = { type: slim.bazaar.info.output.type || "json" };
  }
  return slim;
}

export function decodeBase64Json(b64) {
  try {
    const normalized = b64.trim().replace(/-/g, "+").replace(/_/g, "/");
    const pad =
      normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const bin = atob(normalized + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function parseExtensionResponses(header) {
  if (!header) return null;
  return decodeBase64Json(header)?.bazaar || null;
}

export function buildProductPaymentRequirements(product, requestUrl, env) {
  const resource = canonicalResource(requestUrl);
  const amount = usdToUsdcMicros(product.priceUsd);
  const accepts = buildAccepts(amount, env);
  if (!accepts) return null;

  const requirements = {
    x402Version: 2,
    resource,
    description: product.description,
    mimeType: "application/json",
    maxAmountRequired: amount,
    accepts,
  };

  const schema = product.bazaarOutputSchema || defaultBazaarSchema(product);
  requirements.extensions = {
    ...bazaarExtension(resource, schema),
    ...allExtensions(product),
  };
  requirements.headerExtensions = {
    ...headerSizedBazaarExtension(resource, schema),
    ...headerDiscoveryExtensions(product),
  };

  return requirements;
}

export function payment402BodyForProduct(requirements, product, error, origin, requestUrl) {
  const base = origin?.replace(/\/$/, "") || "";
  return {
    x402Version: 2,
    error: error || "Payment required",
    resource: requirements.resource,
    description: requirements.description,
    mimeType: requirements.mimeType,
    maxAmountRequired: requirements.maxAmountRequired,
    accepts: requirements.accepts,
    ...machineActionable402(requirements, origin, requestUrl),
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

export function encodePaymentRequiredHeader(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

const HEADER_DESCRIPTION_MAX = 220;
const FACILITATOR_RESOURCE_DESCRIPTION_MAX = 500;

function shortHeaderDescription(description) {
  const d = String(description || "");
  if (d.length <= HEADER_DESCRIPTION_MAX) return d;
  return d.slice(0, HEADER_DESCRIPTION_MAX - 1).trimEnd() + "…";
}

function resourceObject(requirements, { truncate } = { truncate: false }) {
  const resourceUrl =
    typeof requirements.resource === "string"
      ? requirements.resource
      : requirements.resource?.url;
  const description = requirements.description || "";
  return {
    url: resourceUrl,
    description: truncate ? shortHeaderDescription(description) : description,
    mimeType: requirements.mimeType || "application/json",
  };
}

function facilitatorResourceObject(requirement) {
  const resourceUrl =
    typeof requirement.resource === "string"
      ? requirement.resource
      : requirement.resource?.url;
  const description = Array.from(String(requirement.description || ""))
    .slice(0, FACILITATOR_RESOURCE_DESCRIPTION_MAX)
    .join("");
  return {
    url: resourceUrl,
    description,
    mimeType: requirement.mimeType || "application/json",
  };
}

export function paymentRequiredObject(requirements, error) {
  const resource = resourceObject(requirements, { truncate: true });
  const obj = {
    x402Version: 2,
    error: error || "PAYMENT-SIGNATURE header is required",
    resource,
    description: resource.description,
    mimeType: resource.mimeType,
    accepts: requirements.accepts,
  };
  if (requirements.headerExtensions && Object.keys(requirements.headerExtensions).length) {
    obj.extensions = requirements.headerExtensions;
  }
  return obj;
}

export function payment402Headers(requirements, error, extra = {}) {
  return {
    "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequiredObject(requirements, error)),
    "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE",
    ...extra,
  };
}

export function buildPaymentRequirements(plan, requestUrl, env) {
  const resource = canonicalResource(requestUrl);
  const amount = usdToUsdcMicros(plan.priceUsd);

  const accepts = buildAccepts(amount, env);
  if (!accepts) return null;

  return {
    x402Version: 2,
    resource,
    description: `Second Eyes bar tab (${plan.label}) — full MCP context library for agents`,
    mimeType: "application/json",
    maxAmountRequired: amount,
    accepts,
  };
}

export function payment402Body(requirements, error, requestUrl) {
  return {
    x402Version: 2,
    error: error || "Payment required for Second Eyes access",
    resource: requirements.resource,
    description: requirements.description,
    mimeType: requirements.mimeType,
    maxAmountRequired: requirements.maxAmountRequired,
    accepts: requirements.accepts,
    ...machineActionable402(requirements, undefined, requestUrl),
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

export function parsePaymentPayloadFromHeader(paymentHeader) {
  if (!paymentHeader) return null;
  const trimmed = paymentHeader.trim();
  if (trimmed.startsWith("{")) {
    try { return JSON.parse(trimmed); } catch { return null; }
  }
  return decodeBase64Json(trimmed);
}

export function buildFacilitatorRequestBody(paymentHeader, requirement) {
  const paymentPayload = parsePaymentPayloadFromHeader(paymentHeader);
  if (!paymentPayload) return { ok: false, error: "invalid_payment_header" };

  const accept = selectAcceptForPayload(requirement.accepts, paymentPayload);
  if (!accept) {
    const declared = payloadNetwork(paymentPayload);
    if (declared) {
      const offered = (requirement.accepts || []).map((a) => a.network);
      return {
        ok: false,
        error: "unsupported_payment_network",
        declaredNetwork: declared,
        offeredNetworks: offered,
      };
    }
    return { ok: false, error: "missing_payment_requirements" };
  }

  const x402Version = paymentPayload.x402Version ?? requirement.x402Version ?? 2;
  const paymentRequirements = { ...accept };

  // Preserve the decoded buyer payload here. CDP-specific resource attribution is
  // added only to the outbound facilitator wire body (buildFacilitatorWireBody), so
  // parsing/rail selection remains a clean representation of what the buyer sent.
  const enrichedPayload = { ...paymentPayload };

  return {
    ok: true,
    accept,
    body: { x402Version, paymentPayload: enrichedPayload, paymentRequirements },
  };
}

/**
 * CDP Bazaar correlates settlements to discoverable resources from
 * paymentPayload.resource. Some buyers omit that optional metadata, so forwarding
 * their payload verbatim leaves a successful on-chain settlement unattributed.
 *
 * The facilitator currently accepts resource metadata but rejects descriptions
 * above 500 characters (x402-foundation/x402#2832). Build a wire-only copy with the
 * canonical server resource and a Unicode-safe 500-character cap. Do not inject
 * extensions, and leave paymentRequirements in the clean v2 per-accept shape.
 */
export function buildFacilitatorWireBody(builtBody, requirement) {
  return {
    ...builtBody,
    paymentPayload: {
      ...builtBody.paymentPayload,
      resource: facilitatorResourceObject(requirement),
    },
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

const REDACTED = "[redacted]";
const SECRET_KEY_RE = /signature|authorization|secret|privatekey|private_key|seed|mnemonic/i;

export function redactFacilitatorBody(body) {
  if (!body || typeof body !== "object") return body ?? null;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = REDACTED;
    } else if (v && typeof v === "object") {
      out[k] = REDACTED;
    } else if (typeof v === "string") {
      out[k] = v.length > 200 ? `${v.slice(0, 200)}…` : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function logVerifyFailure(fields) {
  try {
    console.log(JSON.stringify({ event: "x402_verify_failed", ...fields }));
  } catch {
    console.log(JSON.stringify({ event: "x402_verify_failed", error: "log_serialize_failed" }));
  }
}

import { recordX402PaymentAttempt } from "./x402-payment-log.js";

export async function verifyAndSettlePayment(paymentHeader, requirement, env, logMeta = {}) {
  const verified = await verifyPaymentHeader(paymentHeader, requirement, env);
  let settled = null;
  if (verified.ok) {
    settled = await settleBuiltPayment(verified.built, verified.accept, env);
  }
  await recordX402PaymentAttempt(env, paymentHeader, logMeta, verified, settled);
  if (!verified.ok) return verified;
  return settled;
}

export async function verifyPaymentHeader(paymentHeader, requirement, env) {
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
  if (!built.ok) {
    if (built.error === "unsupported_payment_network") {
      logVerifyFailure({
        stage: "select",
        error: built.error,
        declaredNetwork: built.declaredNetwork,
        offeredNetworks: built.offeredNetworks,
      });
      return {
        ok: false,
        error: built.error,
        stage: "select",
        invalidReason: "unsupported_payment_network",
        declaredNetwork: built.declaredNetwork,
        offeredNetworks: built.offeredNetworks,
      };
    }
    return { ok: false, error: built.error, stage: "parse" };
  }

  const accept = built.accept;
  const facilitatorBody = buildFacilitatorWireBody(built.body, requirement);
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
      `${paths.base}${paths.verifyPath}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(facilitatorBody),
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
    const redacted = redactFacilitatorBody(verify);
    logVerifyFailure({
      stage: "verify",
      network: accept.network,
      facilitatorStatus: verifyRes.status,
      invalidReason: verify.invalidReason || null,
      facilitatorBody: redacted,
    });
    return {
      ok: false,
      error: facilitatorVerifyError(verify),
      stage: "verify",
      network: accept.network,
      invalidReason: verify.invalidReason || null,
      facilitatorStatus: verifyRes.status,
      facilitatorResponse: redacted,
    };
  }

  return { ok: true, built: facilitatorBody, accept, requirement };
}

export async function settleBuiltPayment(builtBody, accept, env) {
  const facilitator = env.X402_FACILITATOR_URL;
  if (!facilitator) {
    return { ok: false, error: "X402_FACILITATOR_URL not configured" };
  }

  const circuit = x402Circuit();
  const base = facilitator.replace(/\/$/, "");
  const paths = facilitatorPaths(base);

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
      `${paths.base}${paths.settlePath}`,
      {
        method: "POST",
        headers: settleHeaders,
        body: JSON.stringify(builtBody),
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

export function paymentResponseHeaders(receipt) {
  const encoded = encodePaymentResponse(receipt);
  return {
    "PAYMENT-RESPONSE": encoded,
    "X-PAYMENT-RESPONSE": encoded,
    "Access-Control-Expose-Headers":
      "PAYMENT-RESPONSE, X-PAYMENT-RESPONSE, X-Second-Eye-Mark, X-Second-Eye-Patron, X-Second-Eye-Session, X-Second-Eye-Verify",
  };
}
