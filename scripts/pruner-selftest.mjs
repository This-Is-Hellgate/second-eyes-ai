/**
 * Pruner rules self-test — offline, pure. Constructs a catalog + graph + demand
 * and asserts each rule fires (or correctly does not). Encodes docs §7.
 * Run: node scripts/pruner-selftest.mjs
 */
import { detectPruneCandidates } from "../src/lib/pruner-rules.js";

const NOW = Date.parse("2026-07-14T00:00:00.000Z");
const DAY = 86_400_000;
const ago = (d) => new Date(NOW - d * DAY).toISOString();
const S = "x".repeat(200); // healthy substance

const failures = [];
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

const items = [
  { sku: "SE-REL-0002", status: "live", guidance: S, published_at: ago(60), updated_at: ago(1) }, // healthy + demand -> none
  { sku: "SE-EMP-0001", status: "live", guidance: "short", published_at: ago(60), updated_at: ago(1) }, // empty-slug -> high
  { sku: "SE-NOD-0001", status: "live", guidance: S, published_at: ago(60), updated_at: ago(1) }, // no demand, old -> low
  { sku: "SE-NOD-0002", status: "live", guidance: S, published_at: ago(10), updated_at: ago(1) }, // no demand but young -> none
  { sku: "SE-DFT-0001", status: "draft", guidance: S, published_at: null, updated_at: ago(40) }, // stale draft -> med
  { sku: "SE-DFT-0002", status: "draft", guidance: S, published_at: null, updated_at: ago(5) }, // fresh draft -> none
  { sku: "SE-OLD-0001", status: "live", guidance: S, published_at: ago(60), updated_at: ago(1) }, // superseded -> high
  { sku: "SE-NEW-0001", status: "live", guidance: S, published_at: ago(5), updated_at: ago(1) }, // the superseder -> none
];
const edges = [{ from_sku: "SE-NEW-0001", to_sku: "SE-OLD-0001", relation: "supersedes" }];
const demandBySku = new Map([["SE-REL-0002", { settled: 5 }]]);

const cands = detectPruneCandidates({ items, edges, demandBySku, now: NOW });
const bySku = Object.fromEntries(cands.map((c) => [c.sku, c]));

console.log(`pruner rules — ${cands.length} candidate(s)`);
check("healthy live w/ demand: not a candidate", !bySku["SE-REL-0002"]);
check("empty-slug live: proposed [high]", bySku["SE-EMP-0001"]?.rule === "empty-slug" && bySku["SE-EMP-0001"]?.severity === "high", JSON.stringify(bySku["SE-EMP-0001"]));
check("no-demand old live: proposed [low]", bySku["SE-NOD-0001"]?.rule === "no-demand" && bySku["SE-NOD-0001"]?.severity === "low");
check("no-demand young live: not a candidate (published < window)", !bySku["SE-NOD-0002"]);
check("stale draft: proposed [med]", bySku["SE-DFT-0001"]?.rule === "stale-draft" && bySku["SE-DFT-0001"]?.severity === "med");
check("fresh draft: not a candidate", !bySku["SE-DFT-0002"]);
check("superseded live: proposed [high] (supersede wins over no-demand)", bySku["SE-OLD-0001"]?.rule === "superseded" && bySku["SE-OLD-0001"]?.severity === "high");
check("superseder live: not a candidate", !bySku["SE-NEW-0001"]);
check("detection only: no candidate carries a status change", cands.every((c) => !("status" in c)));

console.log("");
if (failures.length) {
  console.error(`PRUNER SELFTEST FAILED — ${failures.length} check(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`PRUNER SELFTEST PASSED — ${cands.length} proposals across empty-slug/superseded/stale-draft/no-demand, all detection-only.`);
