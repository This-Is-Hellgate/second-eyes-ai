#!/usr/bin/env node
/**
 * Recover x402 verify/settle failure detail by Cloudflare request id (cf-ray),
 * straight from D1 — no Cloudflare dashboard historical logs required.
 *
 * The x402_verify_failures table stores ONLY redacted detail (signatures and
 * authorizations are stripped by redactFacilitatorBody before persistence), so
 * this script never prints secret material.
 *
 * Usage:
 *   node scripts/x402-failure-lookup.mjs <requestId> [--remote] [--limit N]
 *
 * Examples:
 *   node scripts/x402-failure-lookup.mjs req_ebefc6f9596f2313 --remote
 *   node scripts/x402-failure-lookup.mjs 8f1a2b3c4d5e6f70 --remote --limit 5
 *
 * Local dev DB (omit --remote):
 *   node scripts/x402-failure-lookup.mjs <requestId>
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const limitIdx = args.indexOf("--limit");
const limit =
  limitIdx >= 0 ? Math.min(Math.max(Number(args[limitIdx + 1]) || 20, 1), 100) : 20;
const requestId = args.find((a) => !a.startsWith("--") && a !== String(limit));

if (!requestId) {
  console.error("Usage: node scripts/x402-failure-lookup.mjs <requestId> [--remote] [--limit N]");
  process.exit(2);
}

// Bind via SQL string literal (D1 --command takes no params). The id is a
// cf-ray / hex token; reject anything that is not a safe identifier so a value
// can never break out of the quoted literal.
if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(requestId)) {
  console.error(`Refusing unsafe requestId: ${JSON.stringify(requestId)}`);
  console.error("Expected a cf-ray / hex id, e.g. req_ebefc6f9596f2313");
  process.exit(2);
}

const sql =
  `SELECT id, request_id, created_at, route, stage, declared_network, ` +
  `selected_network, facilitator_status, invalid_reason, facilitator_body, x402_version ` +
  `FROM x402_verify_failures WHERE request_id = '${requestId}' ` +
  `ORDER BY created_at DESC LIMIT ${limit};`;

const cmd = [
  "npx wrangler d1 execute second-eyes-lawful-loop",
  remote ? "--remote" : "",
  `--command "${sql.replace(/"/g, '\\"')}"`,
  "--json -y",
]
  .filter(Boolean)
  .join(" ");

const result = spawnSync(cmd, { encoding: "utf8", cwd: root, shell: true });
if (result.status !== 0) {
  console.error(result.stdout || result.stderr || "wrangler d1 execute failed");
  process.exit(1);
}

let rows = [];
try {
  const parsed = JSON.parse(result.stdout);
  // wrangler --json shape: [{ results: [...] }] (array) or { result: [{ results }] }
  const block = Array.isArray(parsed) ? parsed[0] : parsed?.result?.[0] || parsed;
  rows = block?.results || [];
} catch {
  console.error("Could not parse wrangler JSON output:\n", result.stdout);
  process.exit(1);
}

if (rows.length === 0) {
  console.log(
    `No persisted verify failure for request_id=${requestId} ` +
      `(${remote ? "remote" : "local"} DB). It may predate this logging, or the id is not a cf-ray.`
  );
  process.exit(0);
}

for (const row of rows) {
  if (row.facilitator_body) {
    try {
      row.facilitator_body = JSON.parse(row.facilitator_body);
    } catch {
      /* leave as string */
    }
  }
}

console.log(JSON.stringify({ request_id: requestId, count: rows.length, failures: rows }, null, 2));
