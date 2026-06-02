#!/usr/bin/env node
/**
 * Idempotent migration for access_grants.product_kind / product_slug.
 *
 * Mirrors the runtime guard ensureGrantProductColumns() in
 * functions/_lib/a4a-store.js: it checks pragma_table_info FIRST and only emits
 * an ALTER TABLE ADD COLUMN for a column that is actually absent — because SQLite
 * ADD COLUMN is NOT idempotent and a bare ALTER aborts when the column already
 * exists (the prod "duplicate column" failure). Then it applies the idempotent
 * backfill in seeds/grant-product-metadata.sql.
 *
 * Safe to run any number of times, in any order relative to the runtime guard:
 * once the columns exist this only runs the (idempotent) backfill.
 *
 * Usage:
 *   node scripts/migrate-grant-product-metadata.mjs            # local dev DB
 *   node scripts/migrate-grant-product-metadata.mjs --remote   # production D1
 *   node scripts/migrate-grant-product-metadata.mjs --dry-run  # print plan only
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const DB = "second-eyes-lawful-loop";
const remote = process.argv.includes("--remote");
const dryRun = process.argv.includes("--dry-run");
const remoteFlag = remote ? "--remote" : "";

function wrangler(args) {
  const cmd = `npx wrangler d1 execute ${DB} ${remoteFlag} ${args}`;
  return spawnSync(cmd, { encoding: "utf8", cwd: root, shell: true });
}

/** Read which of product_kind / product_slug already exist on access_grants. */
function existingColumns() {
  const res = wrangler(
    `--command "SELECT name FROM pragma_table_info('access_grants') WHERE name IN ('product_kind','product_slug');" --json -y`
  );
  if (res.status !== 0) {
    console.error(res.stdout || res.stderr);
    process.exit(1);
  }
  const have = new Set();
  try {
    // wrangler --json prints an array of { results: [...] } query objects.
    const parsed = JSON.parse(res.stdout);
    const rows = Array.isArray(parsed) ? parsed.flatMap((q) => q.results || []) : [];
    for (const r of rows) if (r?.name) have.add(r.name);
  } catch {
    // Fall back to a substring probe so a JSON shape change never crashes the
    // migration — worst case we skip a real ALTER and the runtime guard adds it.
    if (/product_kind/.test(res.stdout)) have.add("product_kind");
    if (/product_slug/.test(res.stdout)) have.add("product_slug");
  }
  return have;
}

function main() {
  const have = existingColumns();
  const alters = [];
  if (!have.has("product_kind")) alters.push("ALTER TABLE access_grants ADD COLUMN product_kind TEXT;");
  if (!have.has("product_slug")) alters.push("ALTER TABLE access_grants ADD COLUMN product_slug TEXT;");

  const backfill = readFileSync(join(root, "seeds", "grant-product-metadata.sql"), "utf8");
  const sql = `${alters.join("\n")}\n${backfill}`;

  console.log(`access_grants existing target columns: ${[...have].join(", ") || "(none)"}`);
  console.log(`ALTERs to apply: ${alters.length ? alters.join(" ") : "(none — columns already present)"}`);

  if (dryRun) {
    console.log("\n--dry-run: SQL that WOULD be applied:\n");
    console.log(sql);
    return;
  }

  const file = join(tmpdir(), `migrate-grant-product-${Date.now()}.sql`);
  writeFileSync(file, sql, "utf8");
  try {
    const res = wrangler(`--file "${file}" -y`);
    if (res.status !== 0) {
      console.error(res.stdout || res.stderr);
      process.exit(1);
    }
    console.log(`\ngrant-product-metadata migration applied (${remote ? "remote" : "local"}).`);
    console.log(res.stdout || "");
  } finally {
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

main();
