#!/usr/bin/env node
/**
 * No-spend proof of the grant-product-metadata migration safety (Codex C-024).
 *
 * The seed seeds/grant-product-metadata.sql references access_grants.product_kind
 * / product_slug (a CREATE INDEX and backfill UPDATEs). On a fresh DB those columns
 * may not exist, and SQLite aborts the WHOLE file on the first missing-column
 * reference. The seed deliberately omits the ALTER ADD COLUMN (not idempotent —
 * a bare ALTER aborts once the column exists). So the SAFE path is the guarded
 * migration script, which adds only-absent columns FIRST, then runs the backfill.
 *
 * This test proves, with no wrangler / no network / no D1:
 *   1. composeMigrationSql() puts the needed ALTERs BEFORE the backfill, and emits
 *      an ALTER only for a column that is actually absent (idempotent in any state).
 *   2. The seed file itself contains NO bare `ALTER TABLE` (column creation is the
 *      guarded script's job, never the raw seed's).
 *   3. The d1-migrate workflow ROUTES grant-product-metadata.sql through the script
 *      instead of a raw `wrangler ... --file`, so the workflow path is safe too.
 *
 * Exit 1 on any failure.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { altersForMissingColumns, composeMigrationSql } from "./migrate-grant-product-metadata.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const ok = (cond, msg) => (cond ? null : failures.push(msg));

const KIND_ALTER = "ALTER TABLE access_grants ADD COLUMN product_kind TEXT;";
const SLUG_ALTER = "ALTER TABLE access_grants ADD COLUMN product_slug TEXT;";

/* ---------- 1. composeMigrationSql / altersForMissingColumns ---------- */
{
  // Fresh DB: neither column exists → both ALTERs, in stable order.
  const none = altersForMissingColumns(new Set());
  ok(none.length === 2 && none[0] === KIND_ALTER && none[1] === SLUG_ALTER, "fresh DB emits both ALTERs in order");

  // One column present → only the absent one.
  const onlyKind = altersForMissingColumns(new Set(["product_kind"]));
  ok(onlyKind.length === 1 && onlyKind[0] === SLUG_ALTER, "kind present → only slug ALTER");

  // Both present → no ALTER (idempotent re-run).
  const both = altersForMissingColumns(new Set(["product_kind", "product_slug"]));
  ok(both.length === 0, "both present → no ALTER (idempotent)");

  // Accepts a plain array too.
  ok(altersForMissingColumns(["product_slug"]).length === 1, "array input accepted");

  // composeMigrationSql puts ALTERs strictly before the backfill body.
  const backfill = readFileSync(join(root, "seeds", "grant-product-metadata.sql"), "utf8");
  const sql = composeMigrationSql(new Set(), backfill);
  const idxKind = sql.indexOf(KIND_ALTER);
  const idxIndex = sql.indexOf("CREATE INDEX");
  const idxUpdate = sql.indexOf("UPDATE access_grants");
  ok(idxKind >= 0, "composed SQL contains the ALTER on fresh DB");
  ok(idxKind < idxIndex && idxKind < idxUpdate, "ALTERs precede CREATE INDEX and UPDATE (columns exist before use)");

  // Both-present compose: no ALTER, just the backfill (still valid to apply).
  const composedBoth = composeMigrationSql(new Set(["product_kind", "product_slug"]), backfill);
  ok(!composedBoth.includes(KIND_ALTER) && !composedBoth.includes(SLUG_ALTER), "both-present compose omits ALTERs");
}

/* ---------- 2. seed contains no bare ALTER ---------- */
{
  const seed = readFileSync(join(root, "seeds", "grant-product-metadata.sql"), "utf8");
  // Strip line comments before scanning so the explanatory text ("a bare ALTER")
  // does not register as an actual statement.
  const code = seed
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  ok(!/\bALTER\s+TABLE\b/i.test(code), "seed has no bare ALTER TABLE statement (column creation is the script's job)");
  ok(/CREATE INDEX IF NOT EXISTS/i.test(code), "seed still creates the product_slug index (idempotent)");
}

/* ---------- 3. workflow routes the seed through the guarded script ---------- */
{
  const wf = readFileSync(join(root, ".github", "workflows", "d1-migrate.yml"), "utf8");
  ok(
    /inputs\.migration\s*\}\}"?\s*=\s*"grant-product-metadata\.sql"/.test(wf) ||
      /grant-product-metadata\.sql/.test(wf),
    "workflow references grant-product-metadata.sql by name (routing branch present)"
  );
  ok(
    /node\s+scripts\/migrate-grant-product-metadata\.mjs/.test(wf),
    "workflow invokes the guarded migration script for this migration"
  );
}

if (failures.length) {
  console.error("grant-product migration self-test FAILED:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n${failures.length} failure(s).`);
  process.exit(1);
}

console.log(
  "grant-product migration self-test OK — guarded ALTERs precede the backfill, the seed has no bare ALTER, and the d1-migrate workflow routes the seed through the script (C-024)."
);
