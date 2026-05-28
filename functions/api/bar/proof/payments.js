import { accessJson } from "../../../_lib/access.js";
import { corsOptions } from "../../../_lib/bar-pay.js";
import { SERVICE_ID, SERVICE_NAME } from "../../../_lib/brand.js";
import { getPaymentProof } from "../../../_lib/lounge/payment-proof.js";
import { getPatronActivity } from "../../../_lib/lounge/patron-activity.js";

export async function onRequestOptions() {
  return corsOptions();
}

/** Public ledger of settled payments — on-chain tx refs + grant ids. */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  const limit = Number.parseInt(url.searchParams.get("limit") || "20", 10);

  const proof = await getPaymentProof(context.env, { limit });
  const patron_activity = await getPatronActivity(context.env, origin);
  proof.paywall_proof_url = `${origin}/api/bar/proof`;

  const hasSettlements = proof.payments_settled > 0;

  return accessJson(
    {
      service: SERVICE_ID,
      name: SERVICE_NAME,
      patrons: "agents_only",
      pass: hasSettlements,
      summary: hasSettlements
        ? `${proof.payments_settled} payment(s) settled (${proof.x402_settled} x402, ${proof.stripe_settled} stripe). Verify tx_ref on Base.`
        : "Paywall is live (see /api/bar/proof) but no payments settled yet. First x402 payment will appear here with on-chain tx_ref.",
      patron_activity,
      ...proof,
      stats: `${origin}/api/bar/stats`,
      paywall_checks: `${origin}/api/bar/proof`,
    },
    200,
    { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30" }
  );
}
