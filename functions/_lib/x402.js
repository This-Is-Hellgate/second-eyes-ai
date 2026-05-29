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

const x402Circuit = () => getCircuit("x402_facilitator", { failureThreshold: 5, openMs: 30_000 });

export const X402_EXTENSION_URI = "https://github.com/google-a2a/a2a-x402/v0.1";

/** USDC on Base (6 decimals). */
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913";

export function usdToUsdcMicros(usd) {
  return String(Math.round(usd * 1_000_000));
}

export function buildProductPaymentRequirements(product, requestUrl, env) {
  const payTo = env.X402_PAYTO;
  if (!payTo) return null;

  const network = env.X402_NETWORK || "base";
  const resource = new URL(requestUrl).pathname;

  const accept = {
    scheme: "exact",
    network,
    resource,
    description: product.description,
    mimeType: "application/json",
    asset: USDC_BASE,
    payTo,
    maxAmountRequired: usdToUsdcMicros(product.priceUsd),
    maxTimeoutSeconds: 600,
    extra: {
      name: "USD Coin",
      version: "2",
      product: product.id,
      kind: product.kind,
    },
  };

  if (product.bazaarOutputSchema) {
    accept.outputSchema = product.bazaarOutputSchema;
  }

  return {
    x402Version: 1,
    accepts: [accept],
  };
}

export function payment402BodyForProduct(requirements, product, error, origin) {
  const base = origin?.replace(/\/$/, "") || "";
  return {
    x402Version: 1,
    accepts: requirements.accepts,
    error: error || "Payment required",
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
      bar_tab: "/api/access/purchase?plan=monthly",
    },
  };
}

export function buildPaymentRequirements(plan, requestUrl, env) {
  const payTo = env.X402_PAYTO;
  if (!payTo) return null;

  const network = env.X402_NETWORK || "base";
  const resource = new URL(requestUrl).pathname;

  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network,
        resource,
        description: `Second Eyes bar tab (${plan.label}) — full MCP context library for agents`,
        mimeType: "application/json",
        asset: USDC_BASE,
        payTo,
        maxAmountRequired: usdToUsdcMicros(plan.priceUsd),
        maxTimeoutSeconds: 600,
        extra: {
          name: "USD Coin",
          version: "2",
          plan: plan.id,
        },
      },
    ],
  };
}

export function payment402Body(requirements, error) {
  return {
    x402Version: 1,
    accepts: requirements.accepts,
    error: error || "Payment required for Second Eyes access",
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
        body: JSON.stringify({ paymentHeader, paymentRequirements: accept }),
      },
      DEFAULT_FETCH_TIMEOUT_MS
    );
    circuitSuccess(circuit);
  } catch (err) {
    circuitFailure(circuit);
    return { ok: false, error: "payment_rail_timeout", degraded: true };
  }

  const verify = await verifyRes.json().catch(() => ({}));
  if (!verifyRes.ok || verify.valid === false) {
    return {
      ok: false,
      error: verify.error || verify.message || "Payment verification failed",
      stage: "verify",
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
        body: JSON.stringify({ paymentHeader, paymentRequirements: accept }),
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

  return {
    ok: true,
    receipt: {
      success: true,
      transaction: settle.transaction || settle.txHash || "",
      network: settle.network || accept.network,
      payer: settle.payer || "",
    },
  };
}

export function encodePaymentResponse(receipt) {
  return btoa(JSON.stringify(receipt));
}
