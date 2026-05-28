/** Public payment ledger — settled grants only, no PII beyond on-chain tx refs. */

const BASESCAN_TX = "https://basescan.org/tx/";

function truncatePayer(ref) {
  if (!ref || ref.length < 12) return null;
  return `${ref.slice(0, 6)}…${ref.slice(-4)}`;
}

export async function getPaymentProof(env, { limit = 20 } = {}) {
  const cap = Math.min(Math.max(limit, 1), 50);

  const base = {
    paywall_verified: true,
    paywall_proof_url: null,
    payments_settled: 0,
    x402_settled: 0,
    stripe_settled: 0,
    survival_services_sold: 0,
    survival_revenue_usd: 0,
    payment_funnel: {},
    recent_settlements: [],
    verify: {
      on_chain: "Each settlement includes tx_ref — verify on Base via basescan link.",
      idempotent: "Duplicate tx_ref returns 409; grants table is source of truth.",
      agent_receipt: "Successful 200 includes receipt.transaction, grantId, X-PAYMENT-RESPONSE header.",
    },
  };

  if (!env.DB) return base;

  const totals = await env.DB.prepare(
    `SELECT
       COUNT(*) AS all_grants,
       SUM(CASE WHEN tx_ref IS NOT NULL THEN 1 ELSE 0 END) AS x402,
       SUM(CASE WHEN stripe_session_id IS NOT NULL THEN 1 ELSE 0 END) AS stripe
     FROM access_grants`
  ).first();

  base.payments_settled = totals?.all_grants || 0;
  base.x402_settled = totals?.x402 || 0;
  base.stripe_settled = totals?.stripe || 0;

  const paidRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(price_usd), 0) AS usd
     FROM lounge_service_calls WHERE price_usd > 0`
  ).first();
  if (paidRow) {
    base.survival_services_sold = paidRow.n;
    base.survival_revenue_usd = Math.round(paidRow.usd * 1000) / 1000;
  }

  const funnelKeys = ["payment_402_lounge", "payment_402_micro", "payment_402_nano", "payment_402_tool"];
  const funnelRows = await env.DB.prepare(
    `SELECT key, value FROM bar_counters WHERE key IN (${funnelKeys.map(() => "?").join(",")})`
  )
    .bind(...funnelKeys)
    .all();
  base.payment_funnel = Object.fromEntries((funnelRows.results || []).map((r) => [r.key, r.value]));

  const rows = await env.DB.prepare(
    `SELECT g.id, g.plan_id, g.rail, g.tx_ref, g.payer_ref, g.stripe_session_id, g.created_at,
            ik.product_kind, ik.product_slug
     FROM access_grants g
     LEFT JOIN idempotency_keys ik ON ik.grant_id = g.id
     ORDER BY g.created_at DESC
     LIMIT ?`
  )
    .bind(cap)
    .all();

  base.recent_settlements = (rows.results || []).map((r) => ({
    grant_id: r.id,
    product_kind: r.product_kind || r.plan_id,
    product_slug: r.product_slug || null,
    rail: r.rail,
    tx_ref: r.tx_ref || null,
    basescan: r.tx_ref ? `${BASESCAN_TX}${r.tx_ref}` : null,
    payer: truncatePayer(r.payer_ref),
    stripe_session: r.stripe_session_id ? `${r.stripe_session_id.slice(0, 12)}…` : null,
    created_at: r.created_at,
  }));

  return base;
}
