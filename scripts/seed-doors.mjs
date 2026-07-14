/**
 * Generate seeds/0003_doors.sql from seeds/doors.mjs (the single source of
 * truth). Idempotent INSERT OR REPLACE for items + edges, status 'live'.
 *
 * This script only WRITES A FILE. It never connects to D1. Applying the SQL to
 * a database is a separate, deliberate, approval-gated step (SPEC rule #4):
 *   npx wrangler d1 execute second-eyes-curation --file seeds/0003_doors.sql --local   # local first
 *   npx wrangler d1 execute second-eyes-curation --file seeds/0003_doors.sql            # prod: only with approval
 */
import { writeFileSync } from "node:fs";
import { items, edges } from "../seeds/doors.mjs";

function q(v) {
  if (v === null || v === undefined) return "''";
  return `'${String(v).replace(/'/g, "''")}'`;
}

const lines = [
  "-- GENERATED from seeds/doors.mjs by scripts/seed-doors.mjs — do not edit by hand.",
  "-- Idempotent (INSERT OR REPLACE). Requires migrations 0001 + 0002 applied first.",
  "-- NOT applied to production without explicit approval (SPEC.md standing rule #4).",
  "",
  "BEGIN TRANSACTION;",
];

for (const it of items) {
  lines.push(
    `INSERT OR REPLACE INTO items (sku, slug, name, kind, service, summary, guidance, price_usd, invoke_kind, invoke_key, input_schema, input_example, mime_type, status, version) VALUES (` +
      `${q(it.sku)}, ${q(it.slug)}, ${q(it.name)}, ${q(it.kind)}, ${q(it.service)}, ${q(it.summary)}, ${q(it.guidance)}, ` +
      `${Number(it.price_usd)}, ${q(it.invoke_kind)}, ${q(it.invoke_key || "")}, ${q(it.input_schema || "")}, ${q(it.input_example || "")}, ${q(it.mime_type || "")}, 'live', 1);`
  );
}
for (const e of edges) {
  lines.push(
    `INSERT OR REPLACE INTO edges (from_sku, to_sku, relation, position, note) VALUES (` +
      `${q(e.from)}, ${q(e.to)}, ${q(e.relation)}, ${e.position ?? "NULL"}, ${q(e.note || "")});`
  );
}
lines.push("COMMIT;", "");

writeFileSync(new URL("../seeds/0003_doors.sql", import.meta.url), lines.join("\n"));
console.log(`wrote seeds/0003_doors.sql — ${items.length} items, ${edges.length} edges`);
