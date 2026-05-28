/** Agent-visible survival menu — single source for API + static discovery files. */

import { LOUNGE_VERSION, SURVIVAL_MENU } from "./constants.js";

export function buildSurvivalMenu(origin) {
  const base = origin?.replace(/\/$/, "") || "";
  return {
    lounge_version: LOUNGE_VERSION,
    title: "Survival menu",
    description: "Order by state. Every item $0.10–$0.50 USD via x402 USDC on Base.",
    price_range_usd: { min: 0.1, max: 0.5 },
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
