/**
 * x402 Gateway Middleware
 *
 * Direct equivalent of middleware.ts (createX402Middleware) from
 * coinbase/x402/examples/typescript/servers/cloudfront-lambda-edge.
 *
 * Provides processOriginRequest() and processOriginResponse() that
 * mirror the two Lambda@Edge triggers:
 *   - origin-request: verify payment, return 402 or forward to origin
 *   - origin-response: settle payment only if origin returned success
 *
 * Uses the existing x402.js verify/settle pipeline instead of
 * @x402/core/server, since we already have a working facilitator
 * integration with CDP auth, circuit breakers, and multi-network support.
 */

import { CloudflareHTTPAdapter } from "./x402-gateway-adapter.js";
import {
  buildRoutesConfig,
  matchRoute,
  resolvePaymentConfig,
  PENDING_SETTLEMENT_HEADER,
} from "./x402-gateway-config.js";
import {
  buildProductPaymentRequirements,
  paymentRequiredObject,
  payment402Headers,
  payment402BodyForProduct,
  readPaymentHeader,
  encodePaymentRequiredHeader,
  verifyPaymentHeader,
  settleBuiltPayment,
  paymentResponseHeaders,
} from "./x402.js";
import { SERVICE_PRICES } from "./lounge/constants.js";
import { CANONICAL_HOST } from "./brand.js";

// ── Result types (mirrors MiddlewareResultType from AWS sample) ──────

export const MiddlewareResultType = {
  /** Continue processing - forward request/response to next step */
  CONTINUE: "continue",
  /** Respond immediately - return response to client */
  RESPOND: "respond",
};

// ── HTTPProcessResultType (mirrors @x402/core) ──────────────────────

export const HTTPProcessResultType = {
  NO_PAYMENT_REQUIRED: "no-payment-required",
  PAYMENT_VERIFIED: "payment-verified",
  PAYMENT_ERROR: "payment-error",
};

// ── Middleware factory ───────────────────────────────────────────────

/**
 * Creates x402 middleware for Cloudflare Pages/Workers.
 *
 * Mirrors createX402Middleware(config) from the AWS sample exactly:
 * returns { processOriginRequest, processOriginResponse }.
 *
 * @param {object} env - Cloudflare env with X402_PAYTO, X402_FACILITATOR_URL, etc.
 * @returns {{ processOriginRequest, processOriginResponse }}
 */
export function createX402Middleware(env) {
  const routes = buildRoutesConfig(env);
  const paymentConfig = resolvePaymentConfig(env);

  /**
   * Process origin-request for x402 payment verification.
   *
   * Mirrors middleware.ts processOriginRequest():
   * 1. Security: strip pre-existing settlement header
   * 2. Match route against RoutesConfig
   * 3. If no match -> CONTINUE (not a paid path)
   * 4. Read payment-signature header
   * 5. If no payment -> RESPOND with 402
   * 6. If payment present -> verify via facilitator
   * 7. If verify fails -> RESPOND with 402
   * 8. If verify succeeds -> store pending settlement data, CONTINUE
   *
   * @param {Request} request - Cloudflare Request
   * @returns {Promise<{type: string, request?: Request, response?: Response}>}
   */
  async function processOriginRequest(request) {
    const adapter = new CloudflareHTTPAdapter(request, `https://${CANONICAL_HOST}`);
    const path = adapter.getPath();

    console.log("x402 origin-request:", path);

    // 1. Match route
    const matched = matchRoute(path, routes);
    if (!matched) {
      return { type: MiddlewareResultType.CONTINUE, request };
    }

    // 2. Build product from route config + SERVICE_PRICES
    const slug = path.split("/").pop();
    const product = buildProductFromRoute(slug, matched.config);
    const resourceUrl = adapter.getUrl();
    const requirements = buildProductPaymentRequirements(product, resourceUrl, env);

    if (!requirements) {
      // x402 not configured (no payTo) - pass through
      return { type: MiddlewareResultType.CONTINUE, request };
    }

    // 3. Read payment header
    const paymentHeader = readPaymentHeader(request);

    // 4. No payment -> 402 Payment Required
    if (!paymentHeader) {
      console.log("Payment required for:", path);
      return {
        type: MiddlewareResultType.RESPOND,
        response: build402Response(requirements, product, resourceUrl),
      };
    }

    // 5. Verify payment via facilitator (does NOT settle yet)
    try {
      const verification = await verifyPaymentHeader(paymentHeader, requirements, env);

      if (!verification.ok) {
        console.log("Payment invalid:", verification.error);
        return {
          type: MiddlewareResultType.RESPOND,
          response: build402Response(requirements, product, resourceUrl, verification.error),
        };
      }

      // 6. Payment verified — store pending settlement data
      // AWS sample stores this in x-x402-pending-settlement header (base64).
      // On Cloudflare we attach it to a cloned request.
      console.log("Payment verified, forwarding to origin (settlement deferred)");

      const pendingData = JSON.stringify({
        built: verification.built,
        accept: verification.accept,
        slug,
      });
      const encoded = btoa(pendingData);

      // Clone request and add internal settlement header
      const forwardHeaders = new Headers(request.headers);
      forwardHeaders.set(PENDING_SETTLEMENT_HEADER, encoded);
      const forwardRequest = new Request(request.url, {
        method: request.method,
        headers: forwardHeaders,
        body: request.body,
      });

      return {
        type: MiddlewareResultType.CONTINUE,
        request: forwardRequest,
        // Also pass verification data for the gateway handler
        _pendingSettlement: { built: verification.built, accept: verification.accept, slug },
      };
    } catch (error) {
      console.error("x402 origin-request error:", error);
      return {
        type: MiddlewareResultType.RESPOND,
        response: new Response(
          JSON.stringify({ error: "Internal server error" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        ),
      };
    }
  }

  /**
   * Process origin-response for x402 payment settlement.
   *
   * Mirrors middleware.ts processOriginResponse():
   * 1. Check for pending settlement data
   * 2. If no pending data -> CONTINUE (no payment involved)
   * 3. If origin status >= 400 -> CONTINUE without settling
   * 4. If origin succeeded -> settle payment via facilitator
   * 5. If settlement succeeds -> add receipt headers to response
   * 6. If settlement fails -> RESPOND with 402
   *
   * @param {object} pendingSettlement - The { built, accept, slug } from processOriginRequest
   * @param {Response} originResponse - The response from origin/service
   * @param {object} env - Cloudflare env
   * @returns {Promise<{type: string, response: Response}>}
   */
  async function processOriginResponse(pendingSettlement, originResponse, env) {
    if (!pendingSettlement) {
      return { type: MiddlewareResultType.CONTINUE, response: originResponse };
    }

    const status = originResponse.status;
    console.log("x402 origin-response: status:", status);

    // Only settle if origin succeeded (status < 400)
    if (status >= 400) {
      console.log("Origin failed, skipping settlement - customer not charged");
      return { type: MiddlewareResultType.CONTINUE, response: originResponse };
    }

    try {
      const { built, accept } = pendingSettlement;
      const settlement = await settleBuiltPayment(built, accept, env);

      if (settlement.ok) {
        console.log("Payment settled successfully");
        // Add settlement receipt headers to the origin response
        const headers = new Headers(originResponse.headers);
        const receiptHeaders = paymentResponseHeaders(settlement.receipt);
        for (const [key, value] of Object.entries(receiptHeaders)) {
          headers.set(key, value);
        }
        // Remove internal settlement header
        headers.delete(PENDING_SETTLEMENT_HEADER);

        return {
          type: MiddlewareResultType.CONTINUE,
          response: new Response(originResponse.body, {
            status: originResponse.status,
            statusText: originResponse.statusText,
            headers,
          }),
        };
      } else {
        console.error("Settlement failed:", settlement.error);
        return {
          type: MiddlewareResultType.RESPOND,
          response: new Response(
            JSON.stringify({
              error: "Settlement failed",
              details: settlement.error,
            }),
            {
              status: 402,
              headers: { "Content-Type": "application/json" },
            }
          ),
        };
      }
    } catch (error) {
      console.error("x402 origin-response settlement error:", error);
      return {
        type: MiddlewareResultType.RESPOND,
        response: new Response(
          JSON.stringify({
            error: "Settlement failed",
            details: error instanceof Error ? error.message : "Unknown error",
          }),
          {
            status: 402,
            headers: { "Content-Type": "application/json" },
          }
        ),
      };
    }
  }

  return { processOriginRequest, processOriginResponse };
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Build a product object from route config + SERVICE_PRICES.
 * This bridges the AWS RoutesConfig shape into the product shape
 * that buildProductPaymentRequirements expects.
 */
function buildProductFromRoute(slug, routeConfig) {
  const meta = SERVICE_PRICES[slug];
  const priceUsd = meta
    ? (typeof meta === "number" ? meta : meta?.price_usd)
    : parseFloat((routeConfig.accepts?.price || "$0.01").replace("$", ""));

  return {
    kind: "lounge",
    id: `lounge-${slug}`,
    slug,
    priceUsd,
    oneTime: true,
    description: routeConfig.description || `Lounge service: ${slug}`,
  };
}

/**
 * Build a 402 Payment Required Response.
 *
 * Mirrors toLambdaResponse() from responses.ts — for 402 responses,
 * decodes the PAYMENT-REQUIRED header and includes it in the body.
 *
 * Also matches what the AWS payer-agent's content.py expects:
 * - HTTP 402 status
 * - PAYMENT-REQUIRED header (base64-encoded JSON)
 * - Body with x402Version, accepts[], resource, description
 */
function build402Response(requirements, product, resourceUrl, error) {
  const pr = paymentRequiredObject(requirements, error || "Payment required");
  const body = payment402BodyForProduct(
    requirements,
    product,
    error || "Payment required",
    `https://${CANONICAL_HOST}`
  );

  return new Response(JSON.stringify(body), {
    status: 402,
    statusText: "Payment Required",
    headers: {
      "Content-Type": "application/json",
      ...payment402Headers(requirements, error || "Payment required"),
      "Access-Control-Expose-Headers":
        "PAYMENT-REQUIRED, X-PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE",
    },
  });
}
