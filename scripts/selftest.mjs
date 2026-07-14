/**
 * Second Eyes conformance self-test — the proof gate. Runs OFFLINE (no
 * network, no D1). Two parts:
 *   A. drives the real discovery generator against a fixture + containment
 *      canary, validating output against the x402 spec schemas;
 *   B. validates the REAL catalog (seeds/doors.mjs) against the standing rules
 *      in docs/labeling-and-taxonomy.md — three-layer identity, taxonomy FKs,
 *      no-empty-slug, plain vocabulary, edge graph, and a spec-valid §8 doc.
 *
 * Encodes the SPEC, not the implementation. Run: node scripts/selftest.mjs
 */
import Ajv from "ajv";
import { DiscoveryResponseSchema, PaymentRequirementsSchema, ExtensionsSchema } from "./spec-schemas.mjs";
import { buildX402Resources } from "../src/lib/discovery.js";
import { services as SERVICES, categories as CATEGORIES, items as ITEMS, edges as EDGES } from "../seeds/doors.mjs";

const ajv = new Ajv({ allErrors: true, strict: false });
const failures = [];
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
function validate(schema, obj) {
  const v = ajv.compile(schema);
  return v(obj) ? null : ajv.errorsText(v.errors);
}

const ITEM_TYPES = new Set(["meta-tool", "check", "cookbook", "dataset", "bundle", "guide", "template", "tool"]);
const INVOKE = new Set(["resolve", "verdict", "workersai", "r2"]);
const RELATIONS = new Set(["composes_with", "requires", "step_of", "alternative_to", "pairs_with", "supersedes"]);
const BANNED_VOCAB = ["bar", "lounge", "patron", "tab", "bouncer", "tavern", "bartender", "drink"];

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
const words = (s) => s.trim().split(/\s+/).length;

// ---------------------------------------------------------------------------
// A — discovery generator + containment canary
// ---------------------------------------------------------------------------
const MARKER = "PAID_SUBSTANCE_LEAK_CANARY";
const FIXTURE = [
  { sku: "SE-REL-0002", slug: "loop-detect", name: "I am looping", item_type: "check", service_slug: "agent-reliability", category_slug: "agent-reliability/loop-recovery", price_usd: 0.03, invoke_kind: "verdict", token_estimate: 300, summary: "repeating the same call", guidance: `${MARKER} x`, status: "live", updated_at: "2026-07-14T00:00:00.000Z" },
  { sku: "SE-REL-0001", slug: "help-me", name: "I am about to fail", item_type: "meta-tool", service_slug: "agent-reliability", category_slug: "agent-reliability/triage", price_usd: 0.01, invoke_kind: "verdict", token_estimate: 450, summary: "route my failure", guidance: `${MARKER} y`, status: "live", updated_at: "2026-07-14T00:00:00.000Z" },
];

async function partA() {
  console.log("A. discovery generator + containment");
  const resources = await buildX402Resources(mockEnv(FIXTURE), "https://secondeyesai.com");
  check("resources doc validates DiscoveryResponseSchema", !validate(DiscoveryResponseSchema, resources), validate(DiscoveryResponseSchema, resources) || "");
  for (const item of resources.items) {
    check(`  ${item.metadata.slug}: accepts[0] validates §5.1.2`, !validate(PaymentRequirementsSchema, item.accepts?.[0]), validate(PaymentRequirementsSchema, item.accepts?.[0]) || "");
    check(`  ${item.metadata.slug}: extension carries info+schema`, !validate(ExtensionsSchema, item.extensions), validate(ExtensionsSchema, item.extensions) || "");
  }
  check("free discovery doc leaks no paid substance", !JSON.stringify(resources).includes(MARKER));
}

// ---------------------------------------------------------------------------
// B — the REAL catalog (seeds/doors.mjs)
// ---------------------------------------------------------------------------
async function partB() {
  console.log(`B. real catalog — ${ITEMS.length} items, ${SERVICES.length} services, ${CATEGORIES.length} categories, ${EDGES.length} edges`);

  const serviceSlugs = new Set(SERVICES.map((s) => s.slug));
  const categorySlugs = new Set(CATEGORIES.map((c) => c.slug));
  const skus = new Set();
  const slugs = new Set();

  for (const d of ITEMS) {
    check(`  ${d.slug}: unique sku`, !skus.has(d.sku), d.sku); skus.add(d.sku);
    check(`  ${d.slug}: unique slug`, !slugs.has(d.slug), d.slug); slugs.add(d.slug);
    check(`  ${d.slug}: sku matches SE-<FAM>-<SEQ>`, /^SE-[A-Z]{3}-\d{4}$/.test(d.sku), d.sku);
    check(`  ${d.slug}: valid item_type`, ITEM_TYPES.has(d.item_type), d.item_type);
    check(`  ${d.slug}: valid invoke_kind`, INVOKE.has(d.invoke_kind), d.invoke_kind);
    check(`  ${d.slug}: service_slug resolves`, serviceSlugs.has(d.service_slug), d.service_slug);
    check(`  ${d.slug}: category_slug resolves`, categorySlugs.has(d.category_slug), d.category_slug);
    check(`  ${d.slug}: price 0 < p <= 1.00`, d.price_usd > 0 && d.price_usd <= 1.0, String(d.price_usd));
    check(`  ${d.slug}: token_estimate set`, Number(d.token_estimate) > 0, String(d.token_estimate));
    // naming rule (§1): 3-5 words, no hyphens, not a sku or slug echo
    check(`  ${d.slug}: name 3-5 words`, words(d.name) >= 3 && words(d.name) <= 5, `"${d.name}"=${words(d.name)}`);
    check(`  ${d.slug}: name no hyphens`, !d.name.includes("-"), `"${d.name}"`);
    check(`  ${d.slug}: name not a sku echo`, d.name !== d.sku);
    check(`  ${d.slug}: name not a slug echo`, d.name.toLowerCase().replace(/\s+/g, "-") !== d.slug);
    // THE no-empty-slug rule: a live item must carry real substance.
    const substance = (d.guidance || "").length + (d.tool_code || "").length + (d.reference_doc || "").length;
    check(`  ${d.slug}: has real substance (no empty slug)`, substance >= 40, `substance=${substance} chars`);
    // plain-names rule on the free surface (name + summary)
    const free = `${d.name} ${d.summary}`.toLowerCase();
    for (const w of BANNED_VOCAB) check(`  ${d.slug}: free of "${w}"`, !new RegExp(`\\b${w}\\b`).test(free));
    if (d.invoke_kind === "workersai") check(`  ${d.slug}: workersai names a model`, Boolean(d.invoke_key), "missing invoke_key");
  }

  for (const e of EDGES) {
    check(`  edge ${e.from}->${e.to}: relation valid`, RELATIONS.has(e.relation), e.relation);
    check(`  edge ${e.from}->${e.to}: endpoints exist`, skus.has(e.from) && skus.has(e.to));
  }

  // real set produces a spec-valid discovery doc, with no substance leaking free
  const live = ITEMS.map((d) => ({ ...d, status: "live", updated_at: "2026-07-14T00:00:00.000Z" }));
  const resources = await buildX402Resources(mockEnv(live), "https://secondeyesai.com");
  check("real set: discovery doc validates §8", !validate(DiscoveryResponseSchema, resources), validate(DiscoveryResponseSchema, resources) || "");
  check("real set: every item advertised", resources.items.length === ITEMS.length, `${resources.items.length}/${ITEMS.length}`);
  const rawResources = JSON.stringify(resources);
  const leak = ITEMS.find((d) => (d.guidance && rawResources.includes(d.guidance)) || (d.reference_doc && rawResources.includes(d.reference_doc)) || (d.tool_code && rawResources.includes(d.tool_code)));
  check("real set: no paid substance on free discovery", !leak, leak ? leak.slug : "");
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
  console.log(`SELFTEST PASSED — discovery + ${ITEMS.length} items (identity/taxonomy/substance/vocab/graph) all green.`);
}

main().catch((err) => { console.error("SELFTEST ERROR:", err); process.exit(1); });
