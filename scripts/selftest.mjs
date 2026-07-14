/**
 * Second Eyes conformance self-test — the proof gate. Runs OFFLINE (no
 * network, no D1). Two parts:
 *   A. drives the real discovery generators against a controlled fixture and a
 *      containment canary, validating output against the x402 spec schemas;
 *   B. validates the REAL door set (seeds/doors.mjs) against the standing rules
 *      and proves it generates a spec-valid discovery document.
 *
 * It encodes the SPEC, not the implementation — a drift from the spec or the
 * rules fails here even if the code agrees with itself.
 *
 * Run: node scripts/selftest.mjs   (after `npm install`)
 */
import Ajv from "ajv";
import { DiscoveryResponseSchema, PaymentRequirementsSchema, ExtensionsSchema } from "./spec-schemas.mjs";
import { buildX402Resources } from "../src/lib/discovery.js";
import { items as SEED_DOORS, edges as SEED_EDGES } from "../seeds/doors.mjs";

const ajv = new Ajv({ allErrors: true, strict: false });

const failures = [];
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function validate(schema, obj) {
  const v = ajv.compile(schema);
  return v(obj) ? null : ajv.errorsText(v.errors);
}

const KINDS = new Set(["check", "meta-tool", "guide", "pack"]);
const INVOKE = new Set(["resolve", "verdict", "workersai", "r2"]);
const RELATIONS = new Set(["composes_with", "requires", "step_of", "alternative_to", "pairs_with", "supersedes"]);
const BANNED_VOCAB = ["bar", "lounge", "patron", "tab", "bouncer", "tavern", "bartender", "drink"];

/** Mock env whose SE_DB returns the given live items for any items query. */
function mockEnv(liveItems) {
  return {
    X402_NETWORK: "eip155:84532",
    X402_PAYTO_PUBLIC: "0x0000000000000000000000000000000000000001",
    X402_FACILITATOR_URL: "https://x402.org/facilitator",
    SE_DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async all() { return { results: /FROM items/.test(sql) ? liveItems : [] }; },
          async first() { return null; },
        };
      },
    },
  };
}

function wordCount(s) {
  return s.trim().split(/\s+/).length;
}

// ---------------------------------------------------------------------------
// Part A — discovery generator + containment canary (controlled fixture)
// ---------------------------------------------------------------------------
const GUIDANCE_MARKER = "PAID_GUIDANCE_LEAK_CANARY";
const FIXTURE = [
  { sku: "fx-a", slug: "loop-detect", name: "I am looping", kind: "check", service: "distress", price_usd: 0.03, invoke_kind: "verdict", summary: "repeating the same call", guidance: `${GUIDANCE_MARKER} x`, status: "live", updated_at: "2026-07-14T00:00:00.000Z" },
  { sku: "fx-b", slug: "help-me", name: "I am about to fail", kind: "meta-tool", service: "distress", price_usd: 0.01, invoke_kind: "verdict", summary: "route my failure", guidance: `${GUIDANCE_MARKER} y`, status: "live", updated_at: "2026-07-14T00:00:00.000Z" },
];

async function partA() {
  console.log("A. discovery generator + containment");
  const resources = await buildX402Resources(mockEnv(FIXTURE), "https://secondeyesai.com");
  check("resources doc validates DiscoveryResponseSchema", !validate(DiscoveryResponseSchema, resources), validate(DiscoveryResponseSchema, resources) || "");
  for (const item of resources.items) {
    check(`  ${item.metadata.slug}: accepts[0] validates §5.1.2`, !validate(PaymentRequirementsSchema, item.accepts?.[0]), validate(PaymentRequirementsSchema, item.accepts?.[0]) || "");
    check(`  ${item.metadata.slug}: extension carries info+schema`, !validate(ExtensionsSchema, item.extensions), validate(ExtensionsSchema, item.extensions) || "");
  }
  check("free discovery doc leaks no paid guidance", !JSON.stringify(resources).includes(GUIDANCE_MARKER));
}

// ---------------------------------------------------------------------------
// Part B — the REAL door set (seeds/doors.mjs)
// ---------------------------------------------------------------------------
async function partB() {
  console.log(`B. real door set — ${SEED_DOORS.length} doors, ${SEED_EDGES.length} edges`);

  const skus = new Set();
  const slugs = new Set();
  for (const d of SEED_DOORS) {
    check(`  ${d.slug}: unique sku`, !skus.has(d.sku), d.sku); skus.add(d.sku);
    check(`  ${d.slug}: unique slug`, !slugs.has(d.slug), d.slug); slugs.add(d.slug);
    check(`  ${d.slug}: valid kind`, KINDS.has(d.kind), d.kind);
    check(`  ${d.slug}: valid invoke_kind`, INVOKE.has(d.invoke_kind), d.invoke_kind);
    check(`  ${d.slug}: price 0 < p <= 1.00`, d.price_usd > 0 && d.price_usd <= 1.0, String(d.price_usd));
    check(`  ${d.slug}: has summary + guidance`, Boolean(d.summary && d.guidance));
    // naming rule (#9)
    check(`  ${d.slug}: name 3-5 words`, wordCount(d.name) >= 3 && wordCount(d.name) <= 5, `"${d.name}"=${wordCount(d.name)}`);
    check(`  ${d.slug}: name no hyphens`, !d.name.includes("-"), `"${d.name}"`);
    check(`  ${d.slug}: name not a slug echo`, d.name.toLowerCase().replace(/\s+/g, "-") !== d.slug);
    // plain-names rule (#6) on the free surfaces (name + summary)
    const free = `${d.name} ${d.summary}`.toLowerCase();
    for (const w of BANNED_VOCAB) check(`  ${d.slug}: free of "${w}"`, !new RegExp(`\\b${w}\\b`).test(free));
    // workersai doors must name a model
    if (d.invoke_kind === "workersai") check(`  ${d.slug}: workersai names a model`, Boolean(d.invoke_key), "missing invoke_key");
  }

  // edge graph integrity
  for (const e of SEED_EDGES) {
    check(`  edge ${e.from}->${e.to}: relation valid`, RELATIONS.has(e.relation), e.relation);
    check(`  edge ${e.from}->${e.to}: endpoints exist`, skus.has(e.from) && skus.has(e.to));
  }

  // the real set must produce a spec-valid discovery document
  const live = SEED_DOORS.map((d) => ({ ...d, status: "live", updated_at: "2026-07-14T00:00:00.000Z" }));
  const resources = await buildX402Resources(mockEnv(live), "https://secondeyesai.com");
  check("real set: discovery doc validates §8", !validate(DiscoveryResponseSchema, resources), validate(DiscoveryResponseSchema, resources) || "");
  check("real set: every door advertised", resources.items.length === SEED_DOORS.length, `${resources.items.length}/${SEED_DOORS.length}`);
  check("real set: no paid guidance on free discovery", !SEED_DOORS.some((d) => d.guidance && JSON.stringify(resources).includes(d.guidance)));
}

async function main() {
  await partA();
  await partB();
  console.log("");
  if (failures.length) {
    console.error(`SELFTEST FAILED — ${failures.length} check(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`SELFTEST PASSED — discovery + ${SEED_DOORS.length} real doors (naming/vocab/fields/graph) all green.`);
}

main().catch((err) => {
  console.error("SELFTEST ERROR:", err);
  process.exit(1);
});
