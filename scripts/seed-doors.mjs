/**
 * Generate seeds/0003_doors.sql from seeds/doors.mjs (the single source of
 * truth). Idempotent INSERT OR REPLACE for services + categories + items +
 * edges, status 'live'. Also writes a promotions 'publish' audit row per item.
 *
 * This script only WRITES A FILE. It never connects to D1. Applying the SQL is
 * a separate, deliberate, approval-gated step (SPEC rule #4):
 *   npx wrangler d1 execute second-eyes-curation --file seeds/0003_doors.sql --local
 *   npx wrangler d1 execute second-eyes-curation --file seeds/0003_doors.sql        # prod: approval only
 */
import { writeFileSync } from "node:fs";
import { services, categories, items, edges } from "../seeds/doors.mjs";

function q(v) {
  if (v === null || v === undefined) return "''";
  return `'${String(v).replace(/'/g, "''")}'`;
}
function n(v) {
  return Number(v || 0);
}

const lines = [
  "-- GENERATED from seeds/doors.mjs by scripts/seed-doors.mjs — do not edit by hand.",
  "-- Idempotent (INSERT OR REPLACE). Requires migrations 0001 + 0002 applied first.",
  "-- NOT applied to production without explicit approval (SPEC.md standing rule #4).",
  "",
  "BEGIN TRANSACTION;",
];

for (const s of services) {
  lines.push(
    `INSERT OR REPLACE INTO services (slug, name, kind, description) VALUES (${q(s.slug)}, ${q(s.name)}, ${q(s.kind || "area")}, ${q(s.description || "")});`
  );
}
for (const c of categories) {
  lines.push(
    `INSERT OR REPLACE INTO categories (slug, domain, name, description) VALUES (${q(c.slug)}, ${q(c.domain)}, ${q(c.name)}, ${q(c.description || "")});`
  );
}
for (const it of items) {
  lines.push(
    `INSERT OR REPLACE INTO items (sku, slug, name, item_type, service_slug, category_slug, price_usd, summary, token_estimate, guidance, tool_code, reference_doc, language, invoke_kind, invoke_key, input_schema, input_example, mime_type, source_repo, source_url, license_spdx, provenance, content_hash, status, version, published_at) VALUES (` +
      `${q(it.sku)}, ${q(it.slug)}, ${q(it.name)}, ${q(it.item_type)}, ${q(it.service_slug)}, ${q(it.category_slug)}, ${n(it.price_usd)}, ${q(it.summary)}, ${n(it.token_estimate)}, ` +
      `${q(it.guidance || "")}, ${q(it.tool_code || "")}, ${q(it.reference_doc || "")}, ${q(it.language || "")}, ${q(it.invoke_kind || "resolve")}, ${q(it.invoke_key || "")}, ${q(it.input_schema || "")}, ${q(it.input_example || "")}, ${q(it.mime_type || "")}, ` +
      `${q(it.source_repo || "")}, ${q(it.source_url || "")}, ${q(it.license_spdx || "")}, ${q(it.provenance || "synthesized")}, ${q(it.content_hash || "")}, 'live', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));`
  );
  lines.push(
    `INSERT OR REPLACE INTO promotions (id, sku, action, actor, note) VALUES (${q(`pub_${it.sku}`)}, ${q(it.sku)}, 'publish', 'mike', 'seed publish');`
  );
}
for (const e of edges) {
  lines.push(
    `INSERT OR REPLACE INTO edges (from_sku, to_sku, relation, position, note) VALUES (${q(e.from)}, ${q(e.to)}, ${q(e.relation)}, ${e.position ?? "NULL"}, ${q(e.note || "")});`
  );
}
lines.push("COMMIT;", "");

writeFileSync(new URL("../seeds/0003_doors.sql", import.meta.url), lines.join("\n"));
console.log(`wrote seeds/0003_doors.sql — ${services.length} services, ${categories.length} categories, ${items.length} items, ${edges.length} edges`);
