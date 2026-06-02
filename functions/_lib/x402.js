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

const x402Circuit = () => getCircuit("x402_facilitator", { failureThreshold: 5, openMs: 30_000 });

export const X402_EXTENSION_URI = "https://github.com/google-a2a/a2a-x402/v0.1";

export function usdToUsdcMicros(usd) {
  return String(Math.round(usd * 1_000_000));
}

/**
 * Build the v2 accepts[] for this env. Base (eip155:8453) is always accepts[0];
 * additional rails (Polygon, Solana) append only when an operator has configured
 * AND gated them — see functions/_lib/x402-networks.js. Returns null when no
 * payTo is configured at all (x402 not set up).
 */
function buildAccepts(amount, env) {
  const rails = resolveActiveNetworks(env);
  if (rails.length === 0) return null;
  return rails.map((rail) => buildAcceptEntry(rail, amount));
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
  const resource = canonicalResource(requestUrl);
  const amount = usdToUsdcMicros(product.priceUsd);

  // x402 v2: accepts[] entries stay clean (CDP Bazaar indexer rejects v1-style
  // resource/description/mimeType/outputSchema inside accepts). Discovery
  // metadata lives top-level; only EIP-712 domain (name/version) goes in extra.
  // Base is accepts[0]; extra rails append only when configured + gated.
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
 * Cap for resource.description inside the PAYMENT-REQUIRED header. The header is a
 * single HTTP header line; common intermediaries reject one above ~8KB (nginx
 * large_client_header_buffers default, Node's 16KB total-header parser budget,
 * undici/agent-runtime defaults). The full description still ships in the 402 JSON
 * body and the settle-time extension echo, so cataloging/discovery is unaffected —
 * see payment402BodyForProduct() + buildFacilitatorRequestBody()'s extensions echo.
 */
const HEADER_DESCRIPTION_MAX = 220;

function shortHeaderDescription(description) {
  const d = String(description || "");
  if (d.length <= HEADER_DESCRIPTION_MAX) return d;
  return d.slice(0, HEADER_DESCRIPTION_MAX - 1).trimEnd() + "…";
}

/**
 * The v2 resource object { url, description, mimeType }. `truncate` controls
 * whether the description is capped for header use (true) or kept full for the
 * 402 body / settle echo where there is no header-size constraint (false).
 */
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

/**
 * Canonical x402 v2 payment-required object — the shape the official @x402 client
 * decodes from the PAYMENT-REQUIRED header (see coinbase/agentkit x402ActionProvider:
 * "v2 sends requirements in PAYMENT-REQUIRED header; v1 sends in body").
 *
 * The v2 HTTP transport spec (coinbase/x402 specs/transports-v2/http.md) defines the
 * PaymentRequired object as EXACTLY { x402Version, error, resource{url,description,
 * mimeType}, accepts[] } — there is no top-level `extensions` key and no separate
 * extensions header. So the header stays lean: a short resource.description and clean
 * accepts[], no embedded Bazaar schema. The rich Bazaar metadata (full description +
 * extensions.bazaar) is preserved in the 402 JSON body (payment402BodyForProduct) and
 * echoed into the CDP settle payload server-side from requirement.extensions — neither
 * depends on the header carrying it. Keeping it out of the header is what stops large
 * routes (e.g. help-me) from emitting a multi-KB header that proxies/agents drop.
 */
export function paymentRequiredObject(requirements, error) {
  return {
    x402Version: 2,
    error: error || "PAYMENT-SIGNATURE header is required",
    resource: resourceObject(requirements, { truncate: true }),
    accepts: requirements.accepts,
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

  // Select the accept the buyer actually signed for — with a multi-rail accepts[]
  // a Polygon/Solana signer must NOT be verified against the Base accept[0].
  const accept = selectAcceptForPayload(requirement.accepts, paymentPayload);
  if (!accept) {
    // Distinguish "buyer named a rail we don't advertise" from "no accepts at all"
    // so the failure log/diagnostics show which rail was signed for. Verifying a
    // declared-but-unmatched payload against accepts[0] is the multi-rail trap.
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

  const x402Version =
    paymentPayload.x402Version ?? requirement.x402Version ?? 2;

  // v2 per-accept requirement is CLEAN (PaymentRequirementsV2Schema:
  // scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra) — no resource,
  // no maxAmountRequired. It must equal the buyer's paymentPayload.accepted.
  const paymentRequirements = { ...accept };

  // CDP Bazaar associates the settlement to the resource via paymentPayload.resource.
  // v2 resource is the OBJECT form { url, description, mimeType }. The official client
  // copies it VERBATIM from PAYMENT-REQUIRED — and that header now carries a 220-char
  // TRUNCATED description (the PR #23 header-slimming). So the common object case must
  // NOT be passed through untouched: doing so ships the truncated text to CDP
  // verify/settle and undercuts Bazaar cataloging.
  // verify/settle has no header-size constraint, so re-derive description/mimeType from
  // `requirement` (the full source of truth) for EVERY shape — missing, string, or
  // object — while preserving the buyer's signed resource URL when they sent one.
  const enrichedPayload = { ...paymentPayload };
  const signedResourceUrl =
    typeof enrichedPayload.resource === "string"
      ? enrichedPayload.resource
      : enrichedPayload.resource?.url;
  enrichedPayload.resource = resourceObject({
    ...requirement,
    ...(signedResourceUrl ? { resource: signedResourceUrl } : {}),
  });
  if (requirement.extensions && !enrichedPayload.extensions) {
    enrichedPayload.extensions = requirement.extensions;
  }

  return {
    ok: true,
    accept,
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

/**
 * A CDP /verify error body is small and useful for diagnosis (invalidReason,
 * status, payer) but may echo back signature material. Keep only the diagnostic
 * fields, drop anything that looks like a signature/authorization, and bound the
 * size so an unexpected body can never blow up a log line.
 */
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

/** One structured, secret-free log line per verify failure — fires for EVERY caller. */
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

/** Verify a payment header against requirements without settling (for validate-before-settle doors). */
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

  return { ok: true, built: built.body, accept, requirement };
}

/** Settle a payment that already passed verify (same built body CDP returned ok for). */
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
