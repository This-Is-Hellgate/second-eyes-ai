/**
 * x402 Gateway Configuration
 *
 * Mirrors the AWS CloudFront + Lambda@Edge config.ts from
 * coinbase/x402/examples/typescript/servers/cloudfront-lambda-edge.
 *
 * Defines FACILITATOR_URL, PAY_TO, NETWORK, and ROUTES so the
 * x402 gateway middleware can monetize any HTTP path without
 * touching origin/service code.
 *
 * On Cloudflare Pages, env vars are available at runtime via
 * context.env — so unlike Lambda@Edge we do NOT need to bundle
 * config at build time.
 */

import { SERVICE_PRICES } from "./lounge/constants.js";

// ── Payment configuration (from env at runtime) ──────────────────────

/** Default facilitator — the x402.org public facilitator for testnet. */
export const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";

/** Default network — Base Sepolia (testnet). Production: eip155:8453 */
export const DEFAULT_NETWORK = "eip155:84532";

/**
 * Resolve payment configuration from Cloudflare env.
 * Mirrors config.ts: FACILITATOR_URL, PAY_TO, NETWORK.
 */
export function resolvePaymentConfig(env) {
  return {
    facilitatorUrl: env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL,
    payTo: env.X402_PAYTO || "",
    network: env.X402_NETWORK || DEFAULT_NETWORK,
  };
}

// ── Route configuration ──────────────────────────────────────────────

/**
 * RoutesConfig shape — mirrors @x402/core/server RoutesConfig.
 *
 * Keys are glob patterns matched against request.pathname.
 * Values have { accepts: { scheme, network, payTo, price }, description }.
 *
 * We build this dynamically from SERVICE_PRICES so every lounge service
 * is automatically monetized without manually listing each slug.
 */

/**
 * Build the full RoutesConfig from SERVICE_PRICES + env.
 *
 * AWS config.ts hard-codes routes; we generate them from the existing
 * SERVICE_PRICES registry so adding a new service automatically creates
 * a paid route.
 *
 * @param {object} env - Cloudflare env with X402_PAYTO, X402_NETWORK, etc.
 * @returns {object} RoutesConfig keyed by glob path
 */
export function buildRoutesConfig(env) {
  const { payTo, network } = resolvePaymentConfig(env);
  if (!payTo) return {};

  const routes = {};

  // Per-service routes from SERVICE_PRICES
  for (const [slug, meta] of Object.entries(SERVICE_PRICES)) {
    const priceUsd = typeof meta === "number" ? meta : meta?.price_usd;
    if (!priceUsd || priceUsd <= 0) continue;

    routes[`/api/bar/services/${slug}`] = {
      accepts: {
        scheme: "exact",
        network,
        payTo,
        price: `$${priceUsd}`,
      },
      description: meta?.description || `Lounge service: ${slug}`,
    };
  }

  // Wildcard catch-all for /api/bar/services/* at minimum price
  routes["/api/bar/services/*"] = {
    accepts: {
      scheme: "exact",
      network,
      payTo,
      price: "$0.01",
    },
    description: "Second Eyes Agent Lounge — paid survival services",
  };

  return routes;
}

// ── Route matching ───────────────────────────────────────────────────

/**
 * Match a request path against the RoutesConfig.
 *
 * Mirrors @x402/core/server route matching: exact match first,
 * then most-specific glob, then wildcard.
 *
 * Glob rules (same as AWS sample):
 *   /api/*        — matches one path segment
 *   /api/premium/** — matches any depth
 *
 * @param {string} path - The request pathname
 * @param {object} routes - RoutesConfig from buildRoutesConfig
 * @returns {object|null} The matched route config, or null
 */
export function matchRoute(path, routes) {
  // 1. Exact match
  if (routes[path]) return { path, config: routes[path] };

  // 2. Most-specific glob match
  let bestMatch = null;
  let bestSpecificity = -1;

  for (const [pattern, config] of Object.entries(routes)) {
    if (globMatch(path, pattern)) {
      const specificity = pattern.replace(/\*/g, "").length;
      if (specificity > bestSpecificity) {
        bestSpecificity = specificity;
        bestMatch = { path: pattern, config };
      }
    }
  }

  return bestMatch;
}

/**
 * Simple glob matcher supporting * (one segment) and ** (any depth).
 * Matches the AWS CloudFront + Lambda@Edge route matching behavior.
 */
function globMatch(path, pattern) {
  // Convert glob to regex
  const regexStr = "^" + pattern
    .replace(/\*\*/g, "§DOUBLESTAR§")
    .replace(/\*/g, "[^/]+")
    .replace(/§DOUBLESTAR§/g, ".*")
    + "$";
  return new RegExp(regexStr).test(path);
}

// ── Budget / guardrail constants ─────────────────────────────────────

/** Max price per single x402 call (USD). Rejects any 402 demanding more. */
export const MAX_PRICE_PER_CALL_USD = 1.00;

/** Per-session budget ceiling (USD). */
export const SESSION_BUDGET_USD = 5.00;

/** Hourly spend cap across all sessions (USD). */
export const HOURLY_BUDGET_USD = 10.00;

/** Internal header for passing verified-but-unsettled payment data. */
export const PENDING_SETTLEMENT_HEADER = "x-x402-pending-settlement";
