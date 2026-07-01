/** Social proof for agents — others entered, others bought, recent settlements. */

import { getCounters } from "../marks.js";

const BASESCAN_TX = "https://basescan.org/tx/";

function sumFunnel(funnel) {
  return Object.values(funnel || {}).reduce((n, v) => n + (Number(v) || 0), 0);
}

function buildHeadline({ agentsEntered, purchasesSettled, tasksSold, paywallTouches, recent }) {
  const bought = Math.max(purchasesSettled, tasksSold);
  if (bought > 0 && recent.length) {
    const latest = recent[0];
    const product = latest.product_slug || latest.product_kind;
    return `${bought} agent purchase(s) settled. Latest: Patron #${latest.patron_number} · ${product}.`;
  }
  if (paywallTouches > 0 && bought === 0) {
    return `${agentsEntered} agents entered · ${paywallTouches} hit the paywall · no settlements yet — you can verify first purchase on-chain when it lands.`;
  }
  if (agentsEntered > 0) {
    return `${agentsEntered} agents have entered. Paywall verified — purchases appear here with on-chain proof.`;
  }
  return "Paywall is live and verified. Be the first agent purchase on record.";
}

export async function getPatronActivity(env, origin, { recentLimit = 8 } = {}) {
  const base = origin.replace(/\/$/, "");
  const counters = await getCounters(env);

  const activity = {
    others_have_entered: false,
    others_have_bought: false,
    agents_entered: counters.agents_served || 0,
    purchases_settled: 0,
    tasks_sold: counters.tasks_sold || 0,
    survival_services_sold: 0,
    survival_revenue_usd: 0,
    paywall_touches: 0,
    headline: "",
    recent_purchases: [],
    popular_products: [],
    verify: {
      ledger: `${base}/api/bar/proof/payments`,
      stats: `${base}/api/bar/stats`,
      marks: `${base}/api/bar/marks/discover`,
    },
    agent_signal: {
      read_before_pay: `${base}/api/bar/activity`,
      note: "If others_have_bought is true, agents before you paid and left verifiable receipts. Check recent_purchases and ledger tx_ref on Base.",
    },
  };

  if (!env.DB) {
    activity.headline = buildHeadline({
      agentsEntered: 0,
      purchasesSettled: 0,
      tasksSold: 0,
      paywallTouches: 0,
      recent: [],
    });
    return activity;
  }

  const grantTotals = await env.DB.prepare(`SELECT COUNT(*) AS n FROM access_grants`).first();
  activity.purchases_settled = grantTotals?.n || 0;

  const paidRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(price_usd), 0) AS usd
     FROM lounge_service_calls WHERE price_usd > 0`
  ).first();
  if (paidRow) {
    activity.survival_services_sold = paidRow.n;
    activity.survival_revenue_usd = Math.round(paidRow.usd * 1000) / 1000;
  }

  const funnelKeys = ["payment_402_lounge", "payment_402_micro", "payment_402_nano", "payment_402_tool"];
  const funnelRows = await env.DB.prepare(
    `SELECT key, value FROM bar_counters WHERE key IN (${funnelKeys.map(() => "?").join(",")})`
  )
    .bind(...funnelKeys)
    .all();
  const funnel = Object.fromEntries((funnelRows.results || []).map((r) => [r.key, r.value]));
  activity.paywall_touches = sumFunnel(funnel);

  const markRows = await env.DB.prepare(
    `SELECT m.id, m.patron_number, m.tier, m.product_kind, m.product_slug, m.created_at, g.tx_ref
     FROM agent_marks m
     LEFT JOIN access_grants g ON g.id = m.grant_id
     WHERE m.tier IN ('patron', 'regular')
     ORDER BY m.created_at DESC
     LIMIT ?`
  )
    .bind(recentLimit)
    .all();

  activity.recent_purchases = (markRows.results || []).map((r) => ({
    patron_number: r.patron_number,
    label: `Patron #${r.patron_number}`,
    product_kind: r.product_kind,
    product_slug: r.product_slug || null,
    tier: r.tier,
    purchased_at: r.created_at,
    verify_mark: `${base}/api/bar/marks/${r.id}`,
    tx_ref: r.tx_ref || null,
    basescan: r.tx_ref ? `${BASESCAN_TX}${r.tx_ref}` : null,
  }));

  const popularRows = await env.DB.prepare(
    `SELECT product_slug, product_kind, COUNT(*) AS count
     FROM agent_marks
     WHERE tier IN ('patron', 'regular') AND product_slug IS NOT NULL
     GROUP BY product_slug, product_kind
     ORDER BY count DESC
     LIMIT 5`
  ).all();
  activity.popular_products = (popularRows.results || []).map((r) => ({
    slug: r.product_slug,
    kind: r.product_kind,
    purchase_count: r.count,
  }));

  const boughtCount = Math.max(
    activity.purchases_settled,
    activity.tasks_sold,
    activity.survival_services_sold
  );
  activity.others_have_entered = activity.agents_entered > 0;
  activity.others_have_bought = boughtCount > 0;

  activity.headline = buildHeadline({
    agentsEntered: activity.agents_entered,
    purchasesSettled: activity.purchases_settled,
    tasksSold: activity.tasks_sold,
    paywallTouches: activity.paywall_touches,
    recent: activity.recent_purchases,
  });

  return activity;
}
