/**
 * Pruner detection rules — pure and offline-testable. Given the catalog, the
 * routing graph, per-sku organic demand, and `now`, return the retire-PROPOSAL
 * candidates. Detection only: the pruner never retires — a human confirms every
 * retirement (docs/labeling-and-taxonomy.md §7). Severity sets review priority.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
export const SUBSTANCE_FLOOR = 40; // the no-empty-slug threshold, enforced at runtime

export function detectPruneCandidates({
  items,
  edges = [],
  demandBySku = new Map(),
  now,
  demandWindowDays = 45,
  staleDraftDays = 30,
}) {
  const candidates = [];
  const live = items.filter((i) => i.status === "live");
  const liveSkus = new Set(live.map((i) => i.sku));
  // superseded: a LIVE item that another LIVE item supersedes (inbound edge).
  const superseded = new Set(
    edges
      .filter((e) => e.relation === "supersedes" && liveSkus.has(e.from_sku) && liveSkus.has(e.to_sku))
      .map((e) => e.to_sku)
  );

  for (const it of items) {
    if (it.status === "live") {
      const substance = (it.guidance || "").length + (it.tool_code || "").length + (it.reference_doc || "").length;
      if (substance < SUBSTANCE_FLOOR) {
        candidates.push({ sku: it.sku, rule: "empty-slug", severity: "high", note: `live item substance ${substance} < ${SUBSTANCE_FLOOR} chars` });
        continue;
      }
      if (superseded.has(it.sku)) {
        candidates.push({ sku: it.sku, rule: "superseded", severity: "high", note: "a live item supersedes this one" });
        continue;
      }
      const publishedMs = it.published_at ? Date.parse(it.published_at) : NaN;
      const settled = (demandBySku.get(it.sku) || {}).settled || 0;
      if (settled === 0 && Number.isFinite(publishedMs) && now - publishedMs > demandWindowDays * DAY_MS) {
        candidates.push({ sku: it.sku, rule: "no-demand", severity: "low", note: `0 organic settlements in ${demandWindowDays}d since published` });
      }
    } else if (it.status === "draft") {
      const updatedMs = it.updated_at ? Date.parse(it.updated_at) : NaN;
      if (!it.published_at && Number.isFinite(updatedMs) && now - updatedMs > staleDraftDays * DAY_MS) {
        candidates.push({ sku: it.sku, rule: "stale-draft", severity: "med", note: `draft untouched > ${staleDraftDays}d, never published` });
      }
    }
  }
  return candidates;
}

export const SEVERITY_ORDER = { high: 0, med: 1, low: 2 };
