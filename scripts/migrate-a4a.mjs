#!/usr/bin/env node
/**
 * Apply A4A commerce tables to D1 (a4a_tasks, access_grants).
 * Usage: node scripts/migrate-a4a.mjs [--remote]
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const remote = process.argv.includes("--remote");
const sql = readFileSync(join(root, "seeds", "a4a-commerce.sql"), "utf8") +
  readFileSync(join(root, "seeds", "micro-redemptions.sql"), "utf8") +
  readFileSync(join(root, "seeds", "bar-marks.sql"), "utf8") +
  readFileSync(join(root, "seeds", "resilience-idempotency.sql"), "utf8") +
  readFileSync(join(root, "seeds", "lounge-system.sql"), "utf8");

const file = join(tmpdir(), `migrate-a4a-${Date.now()}.sql`);
writeFileSync(file, sql, "utf8");

try {
  const remoteFlag = remote ? "--remote" : "";
  const cmd = `npx wrangler d1 execute second-eyes-lawful-loop ${remoteFlag} --file "${file}" --json -y`;
  const result = spawnSync(cmd, { encoding: "utf8", cwd: root, shell: true });
  if (result.status !== 0) {
    console.error(result.stdout || result.stderr);
    process.exit(1);
  }
  console.log(`A4A commerce migration applied (${remote ? "remote" : "local"}).`);
  console.log(result.stdout || "");
} finally {
  try {
    unlinkSync(file);
  } catch {
    /* ignore */
  }
}
