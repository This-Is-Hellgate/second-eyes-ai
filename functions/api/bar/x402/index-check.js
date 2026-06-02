/**
 * /api/bar/x402/index-check — x402 / Coinbase survival bar.
 *
 * Is an x402 endpoint actually indexed on the CDP Bazaar? If not, is it a format
 * problem (fixable with x402-doctor) or CDP's indexing backlog? No session;
 * launch recovery price ($0.05) because "am I indexed yet?" is a polling question.
 *
 *   GET  /api/bar/x402/index-check?payTo=0x…&url=https://…
 *   POST /api/bar/x402/index-check  { "payTo": "0x…", "url": "https://…" }
 */

import { checkBazaarIndex } from "../../../_lib/bazaar-index.js";
import {
  corsOptions,
  handlePaidFetch,
  hasBarTabAccess,
  hasToolAccess,
  consumeMicroAccess,
} from "../../../_lib/bar-pay.js";
import { accessJson } from "../../../_lib/access.js";

const TOOL_SLUG = "x402-survival";
const TAP_SLUG = "bazaar-index-check";
const PRICE_USD = 0.05;

const PRODUCT = {
  kind: "nano",
  id: TAP_SLUG,
  slug: TAP_SLUG,
  tool: TOOL_SLUG,
  tier: "nano",
  priceUsd: PRICE_USD,
  access: "paid",
  oneTime: true,
  description:
    "bazaar-index-check: is your x402 endpoint indexed on the CDP Bazaar? If not, format problem or backlog?",
  bazaarOutputSchema: {
    input: { type: "http", method: "GET" },
    output: {
      tool: TAP_SLUG,
      indexed: false,
      where: [],
      wallet_resource_count: 0,
      reason: "backlog_or_no_settlement",
      detail: "Your 402 is clean v2 but it isn't in the index. CDP indexes on a settled payment and lags.",
      next_step: "Settle one real payment against the endpoint, then re-check in 24-72h.",
    },
  },
};

export async function onRequestOptions() {
  return corsOptions("GET, POST, OPTIONS");
}

export async function onRequestGet(context) {
  const u = new URL(context.request.url);
  return handle(context, {
    payTo: u.searchParams.get("payTo") || null,
    url: u.searchParams.get("url") || null,
  });
}

export async function onRequestPost(context) {
  let input;
  try {
    const data = await context.request.json();
    input = { payTo: data?.payTo || null, url: data?.url || null };
  } catch {
    return accessJson(
      { error: "invalid_json", note: "POST a JSON body: { payTo, url }." },
      400,
      { "Access-Control-Allow-Origin": "*" }
    );
  }
  return handle(context, input);
}

function handle(context, input) {
  const payload = async () => checkBazaarIndex(input);
  return handlePaidFetch(context, PRODUCT, payload, async (token) => {
    const tab = await hasBarTabAccess(token, context.env);
    if (tab) return { ok: true, claims: tab };
    const toolClaims = await hasToolAccess(token, TOOL_SLUG, context.env);
    if (toolClaims) return { ok: true, claims: toolClaims };
    return consumeMicroAccess(token, TAP_SLUG, TOOL_SLUG, context.env);
  });
}
