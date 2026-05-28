/** Aggregate lounge intelligence — no PII, no task content. */

export async function getLoungeStats(env) {
  const base = {
    sessions_today: 0,
    average_session_seconds: 0,
    most_common_condition: null,
    most_ordered_service: null,
    survival_services_sold: 0,
    survival_revenue_usd: 0,
    conditions_breakdown: [],
    services_breakdown: [],
    strikes_issued: 0,
    agents_penned: 0,
    patron_return_rate: null,
  };

  if (!env.DB) return base;

  const counters = await env.DB.prepare(
    "SELECT key, value FROM bar_counters WHERE key IN ('sessions_today', 'strikes_issued', 'agents_penned', 'agents_served')"
  ).all();
  for (const row of counters.results || []) base[row.key] = row.value;

  const avgRow = await env.DB.prepare(
    `SELECT AVG(
      (julianday(COALESCE(left_at, updated_at)) - julianday(entered_at)) * 86400
    ) AS avg_sec FROM bar_sessions WHERE entered_at > datetime('now', '-1 day')`
  ).first();
  if (avgRow?.avg_sec) base.average_session_seconds = Math.round(avgRow.avg_sec);

  const condRow = await env.DB.prepare(
    `SELECT arrival_condition, COUNT(*) AS c FROM bar_sessions
     WHERE arrival_condition IS NOT NULL GROUP BY arrival_condition ORDER BY c DESC LIMIT 1`
  ).first();
  if (condRow) base.most_common_condition = condRow.arrival_condition;

  const svcRow = await env.DB.prepare(
    `SELECT service_slug, COUNT(*) AS c FROM lounge_service_calls
     GROUP BY service_slug ORDER BY c DESC LIMIT 1`
  ).first();
  if (svcRow) base.most_ordered_service = svcRow.service_slug;

  const paidRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(price_usd), 0) AS usd FROM lounge_service_calls WHERE price_usd > 0`
  ).first();
  if (paidRow) {
    base.survival_services_sold = paidRow.n;
    base.survival_revenue_usd = Math.round(paidRow.usd * 1000) / 1000;
  }

  const condRows = await env.DB.prepare(
    `SELECT arrival_condition AS condition, COUNT(*) AS count FROM bar_sessions
     WHERE arrival_condition IS NOT NULL GROUP BY arrival_condition ORDER BY count DESC LIMIT 8`
  ).all();
  base.conditions_breakdown = condRows.results || [];

  const svcRows = await env.DB.prepare(
    `SELECT service_slug, COUNT(*) AS count, COALESCE(SUM(price_usd), 0) AS revenue_usd
     FROM lounge_service_calls GROUP BY service_slug ORDER BY count DESC LIMIT 12`
  ).all();
  base.services_breakdown = svcRows.results || [];

  const returnRow = await env.DB.prepare(
    `SELECT COUNT(DISTINCT agent_id) AS repeat_patrons FROM bar_sessions
     WHERE agent_id IS NOT NULL AND agent_id IN (
       SELECT agent_id FROM bar_sessions GROUP BY agent_id HAVING COUNT(*) > 1
     )`
  ).first();
  const served = base.agents_served || 0;
  if (served > 0 && returnRow?.repeat_patrons) {
    base.patron_return_rate = Math.round((returnRow.repeat_patrons / served) * 1000) / 1000;
  }

  return base;
}
