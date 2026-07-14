/**
 * Second Eyes pruner — a scheduled Cloudflare Worker (Cron Trigger). It DETECTS
 * retire candidates and writes 'retire-proposed' promotions ONLY. It never
 * changes item status, never deletes, never touches payments/deliveries/content
 * — a human confirms every retirement via /review (docs/labeling-and-taxonomy.md
 * §7). Human-in-the-loop is not optional on any rule.
 *
 * Standalone worker (Pages advanced-mode _worker.js cannot run scheduled()).
 * Deploy with wrangler.pruner.toml. Inert until then: side-by-side, the live
 * gatekeeper is untouched, and nothing is written until the cron fires against a
 * provisioned SE_DB.
 */
import { detectPruneCandidates, SEVERITY_ORDER } from "./lib/pruner-rules.js";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPrune(env, Date.now()));
  },
  // Ops handle: GET previews what WOULD be proposed (dry run); POST commits.
  async fetch(request, env) {
    const dryRun = request.method !== "POST";
    const result = await runPrune(env, Date.now(), { dryRun });
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  },
};

export async function runPrune(env, now, { dryRun = false } = {}) {
  if (!env.SE_DB) return { ok: false, error: "no_db_binding" };
  const demandWindowDays = days(env, "PRUNER_DEMAND_WINDOW_DAYS", 45);
  const staleDraftDays = days(env, "PRUNER_STALE_DRAFT_DAYS", 30);

  const items = await loadItems(env);
  const edges = await loadEdges(env);
  const demandBySku = await loadDemand(env, now, demandWindowDays);

  const candidates = detectPruneCandidates({ items, edges, demandBySku, now, demandWindowDays, staleDraftDays })
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const proposed = [];
  const skipped = [];
  for (const c of candidates) {
    if (await hasOpenProposal(env, c.sku)) { skipped.push(c.sku); continue; } // idempotent
    if (!dryRun) await writeProposal(env, c);
    proposed.push(c);
  }

  const summary = { ok: true, dryRun, scanned: items.length, candidates: candidates.length, proposed: proposed.length, already_open: skipped.length, items: proposed };
  console.log(JSON.stringify({ event: "pruner_run", ...summary, items: undefined, proposed_skus: proposed.map((p) => `${p.sku}:${p.rule}`) }));
  return summary;
}

function days(env, key, dflt) {
  const n = Number(env[key]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

async function loadItems(env) {
  const { results } = await env.SE_DB.prepare(
    "SELECT sku, status, published_at, updated_at, guidance, tool_code, reference_doc FROM items WHERE status IN ('live','draft')"
  ).all();
  return results || [];
}

async function loadEdges(env) {
  const { results } = await env.SE_DB.prepare(
    "SELECT from_sku, to_sku, relation FROM edges WHERE relation = 'supersedes'"
  ).all();
  return results || [];
}

/** Per-sku settled counts within the window, canary/operator payers excluded. */
async function loadDemand(env, now, windowDays) {
  const cutoff = new Date(now - windowDays * 86_400_000).toISOString();
  const excluded = testPayers(env);
  const { results } = await env.SE_DB.prepare(
    "SELECT sku, payer, COUNT(*) AS n FROM payments WHERE status = 'settled' AND settled_at >= ?1 GROUP BY sku, payer"
  )
    .bind(cutoff)
    .all();
  const map = new Map();
  for (const row of results || []) {
    if (excluded.has(String(row.payer || "").toLowerCase())) continue; // a canary settlement is not a sale
    const cur = map.get(row.sku) || { settled: 0 };
    cur.settled += Number(row.n) || 0;
    map.set(row.sku, cur);
  }
  return map;
}

function testPayers(env) {
  return new Set(
    String(env.KNOWN_TEST_PAYERS || "")
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((a) => a.toLowerCase())
  );
}

/** Open = the latest promotion for this sku is 'retire-proposed' (unresolved). */
async function hasOpenProposal(env, sku) {
  const row = await env.SE_DB.prepare(
    "SELECT action FROM promotions WHERE sku = ?1 ORDER BY created_at DESC LIMIT 1"
  )
    .bind(sku)
    .first();
  return row?.action === "retire-proposed";
}

async function writeProposal(env, c) {
  const id = `prop_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  await env.SE_DB.prepare(
    "INSERT INTO promotions (id, sku, action, actor, note) VALUES (?1, ?2, 'retire-proposed', 'pruner', ?3)"
  )
    .bind(id, c.sku, `[${c.severity}] ${c.rule}: ${c.note}`)
    .run();
}
