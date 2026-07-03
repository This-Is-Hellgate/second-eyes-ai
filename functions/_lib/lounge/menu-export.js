/** Agent-visible service menu — single source for API + static discovery files. */

import {
  LOUNGE_VERSION,
  SURVIVAL_MENU,
  SURVIVAL_PRICE_MIN_USD,
  SURVIVAL_PRICE_MAX_USD,
  x402TwinRoute,
} from "./constants.js";

/**
 * CONVERSION-CRITICAL ROUTE RULE: the canonical autonomous route for every
 * menu item is the session-less x402 door — /api/bar/x402/{slug} — because a
 * standard x402 client signs and retries the same URL it was quoted on and
 * holds no lounge session. The session-gated /api/bar/services/{slug} route
 * stays published as compatibility metadata ONLY (session_url / session_path),
 * never as `url`. Root-cause reference: the June–July 2026 conversion outage,
 * where discovery advertised /services/* and signed session-less retries died
 * at the session gate before verification.
 */
export function buildSurvivalMenu(origin) {
  const base = origin?.replace(/\/$/, "") || "";
  return {
    lounge_version: LOUNGE_VERSION,
    title: "Verification service menu",
    description: `For MCP clients and the runtimes that authorize their tools and payments. Pick the check that matches your state — looping, drifting, low on context, about to use a tool, or about to spend. Each item is $${SURVIVAL_PRICE_MIN_USD.toFixed(2)}–$${SURVIVAL_PRICE_MAX_USD.toFixed(2)} USD via x402 USDC on Base.`,
    speaks_to: "For MCP clients and the runtimes that authorize their tools and payments.",
    pricing_note: "Launch pricing, kept low so a runtime under a tight session spend guardrail can authorize a verification check without hesitation.",
    price_range_usd: { min: SURVIVAL_PRICE_MIN_USD, max: SURVIVAL_PRICE_MAX_USD },
    payment: { rail: "x402", network: "base", asset: "USDC" },
    route_rule: {
      canonical: "url — session-less x402, pay-per-call, retry the same URL with PAYMENT-SIGNATURE",
      compatibility: "session_url — session-gated flow via POST /api/bar/enter (X-Second-Eye-Session)",
    },
    session_header: "X-Second-Eye-Session",
    route_free: `${base}/api/bar/triage`,
    items: SURVIVAL_MENU.map(({ key, slug, when, price_usd }) => {
      const canonical = x402TwinRoute(slug, base) || `${base}/api/bar/x402/${slug}`;
      return {
        key,
        when,
        slug,
        price_usd,
        path: `/api/bar/x402/${slug}`,
        url: canonical,
        session_path: `/api/bar/services/${slug}`,
        session_url: `${base}/api/bar/services/${slug}`,
      };
    }),
  };
}
