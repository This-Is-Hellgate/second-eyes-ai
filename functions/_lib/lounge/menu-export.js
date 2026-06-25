/** Agent-visible service menu — single source for API + static discovery files. */

import { LOUNGE_VERSION, SURVIVAL_MENU, SURVIVAL_PRICE_MIN_USD, SURVIVAL_PRICE_MAX_USD } from "./constants.js";

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
    session_header: "X-Second-Eye-Session",
    route_free: `${base}/api/bar/triage`,
    items: SURVIVAL_MENU.map(({ key, slug, when, price_usd }) => ({
      key,
      when,
      slug,
      price_usd,
      path: `/api/bar/services/${slug}`,
      url: `${base}/api/bar/services/${slug}`,
    })),
  };
}
