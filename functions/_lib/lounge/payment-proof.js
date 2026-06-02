/** Public payment ledger — settled grants only, no PII beyond on-chain tx refs. */

import { getKnownPayers, normalizePayer, maskPayer } from "./known-payers.js";

const BASESCAN_TX = "https://basescan.org/tx/";

function truncatePayer(ref) {
  if (!ref || ref.length < 12) return null;
  return `${ref.slice(0, 6)}…${ref.slice(-4)}`;
}

/**
 * External-payer signal: detects x402 settlements from payers NOT in the known
 * operator/test wallet set (see known-payers.js). Surfaces the first external
 * agent payer, the most recent one, and a distinct count — agent-facing language
 * only (distinct external agent payers, never "customers"). Exposes masked
 * addresses only; never more payer info than the public ledger already shows.
 */
export async function getExternalPayerSignal(env) {
  const signal = {
    external_buyer_signal: false,
    external_distinct_payers: 0,
    first_external_payer_seen: null,
    latest_external_settlement: null,
    unclassified_payer_clusters: [],
    masked_payer_warning: null,
    known_test_payers_configured: 0,
    note: "external_buyer_signal=true means an x402 settlement arrived from a payer outside the known operator/test wallet set. Masked addresses only; verify tx_ref on Base.",
  };

  const known = getKnownPayers(env);
  signal.known_test_payers_configured = known.size;

  if (!env.DB) return signal;

  let rows;
  try {
    rows = await env.DB.prepare(
      `SELECT id, tx_ref, payer_ref, created_at
       FROM access_grants
       WHERE payer_ref IS NOT NULL AND tx_ref IS NOT NULL
       ORDER BY created_at ASC`
    ).all();
  } catch {
    return signal;
  }

  const distinct = new Set();
  // Per-payer cluster: groups settlements by the (full, server-side) payer key so
  // an operator can classify a masked external payer. The full address never
  // leaves the worker — only the mask + a public tx_ref to resolve it on Base.
  const clusters = new Map();
  let first = null;
  let latest = null;

  for (const r of rows.results || []) {
    const key = normalizePayer(r.payer_ref);
    if (!key || known.has(key)) continue;
    distinct.add(key);
    const entry = {
      payer: maskPayer(r.payer_ref),
      tx_ref: r.tx_ref,
      basescan: `${BASESCAN_TX}${r.tx_ref}`,
      settled_at: r.created_at,
    };
    if (!first) first = entry;
    latest = entry;

    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = {
        payer: maskPayer(r.payer_ref),
        settlements: 0,
        first_tx_ref: r.tx_ref,
        first_basescan: `${BASESCAN_TX}${r.tx_ref}`,
        first_settled_at: r.created_at,
        latest_settled_at: r.created_at,
      };
      clusters.set(key, cluster);
    }
    cluster.settlements += 1;
    cluster.latest_settled_at = r.created_at;
  }

  signal.external_distinct_payers = distinct.size;
  signal.external_buyer_signal = distinct.size > 0;
  signal.first_external_payer_seen = first;
  signal.latest_external_settlement = latest;
  // Masked clusters awaiting classification — each is a distinct external payer
  // NOT in KNOWN_TEST_PAYERS. Operators resolve first_tx_ref on Base to recover
  // the full address, then (if it is an operator/test wallet) add the FULL
  // address to KNOWN_TEST_PAYERS. A mask can never be added to the env set: the
  // match is on the full 0x address, so a masked form would never exclude.
  signal.unclassified_payer_clusters = [...clusters.values()];
  if (distinct.size > 0) {
    signal.masked_payer_warning =
      `${distinct.size} external payer(s) are reported masked and cannot be ` +
      `silenced by mask alone: KNOWN_TEST_PAYERS matches FULL 0x addresses. ` +
      `Resolve each cluster's first_tx_ref on Base to recover the full payer ` +
      `address, then add it to KNOWN_TEST_PAYERS if it is an operator/test wallet. ` +
      `See docs/external-payer-monitoring.md#classifying-a-masked-payer.`;
  }
  return signal;
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
    external_payer_signal: {
      external_buyer_signal: false,
      external_distinct_payers: 0,
      first_external_payer_seen: null,
      latest_external_settlement: null,
      unclassified_payer_clusters: [],
      masked_payer_warning: null,
      known_test_payers_configured: 0,
    },
    verify: {
      on_chain: "Each settlement includes tx_ref — verify on Base via basescan link.",
      idempotent: "Duplicate tx_ref returns 409; grants table is source of truth.",
      agent_receipt: "Successful 200 includes receipt.transaction, grantId, X-PAYMENT-RESPONSE header.",
    },
  };

  base.external_payer_signal = await getExternalPayerSignal(env);

  if (!env.DB) return base;

  // access_grants.product_* may not exist until seeds/grant-product-metadata.sql
  // (or the runtime ensure in recordAccessGrant) has run; select them only if present.
  let grantHasProductCols = false;
  try {
    const cols = await env.DB.prepare(
      `SELECT name FROM pragma_table_info('access_grants') WHERE name = 'product_slug'`
    ).first();
    grantHasProductCols = Boolean(cols?.name);
  } catch {
    grantHasProductCols = false;
  }

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
            ${grantHasProductCols ? "g.product_kind AS g_kind, g.product_slug AS g_slug," : "NULL AS g_kind, NULL AS g_slug,"}
            ik.product_kind AS ik_kind, ik.product_slug AS ik_slug,
            m.product_kind AS m_kind, m.product_slug AS m_slug
     FROM access_grants g
     LEFT JOIN idempotency_keys ik ON ik.grant_id = g.id
     LEFT JOIN agent_marks m ON m.grant_id = g.id
     ORDER BY g.created_at DESC
     LIMIT ?`
  )
    .bind(cap)
    .all();

  base.recent_settlements = (rows.results || []).map((r) => ({
    grant_id: r.id,
    // Prefer the self-describing grant column; fall back to idempotency, then the
    // patron mark (which always retained the slug), then plan_id as last resort.
    product_kind: r.g_kind || r.ik_kind || r.m_kind || r.plan_id,
    product_slug: r.g_slug || r.ik_slug || r.m_slug || null,
    rail: r.rail,
    tx_ref: r.tx_ref || null,
    basescan: r.tx_ref ? `${BASESCAN_TX}${r.tx_ref}` : null,
    payer: truncatePayer(r.payer_ref),
    stripe_session: r.stripe_session_id ? `${r.stripe_session_id.slice(0, 12)}…` : null,
    created_at: r.created_at,
  }));

  return base;
}
