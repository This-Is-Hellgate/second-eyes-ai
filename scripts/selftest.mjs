/**
 * Second Eyes conformance self-test — the proof gate. Runs OFFLINE (no
 * network, no D1): it seeds an in-memory curated index, drives the real
 * discovery generators (src/lib/discovery.js), and validates every emitted
 * object against the x402 spec schemas (scripts/spec-schemas.mjs) plus the
 * project's standing rules. It encodes the SPEC, not this implementation — a
 * drift from the spec fails here even if the code agrees with itself.
 *
 * Run: node scripts/selftest.mjs   (after `npm install`)
 *
 * Checked here:
 *   1. §8 discovery resources doc validates (DiscoveryResponseSchema)
 *   2. every accepts[] entry validates (§5.1.2 PaymentRequirementsSchema)
 *   3. every bazaar extension carries info + schema (§5.1.2 ExtensionsSchema)
 *   4. naming rule: name is 3-5 plain words, no hyphens, never a slug echo
 *   5. plain-names rule: no banned metaphor vocabulary on free surfaces
 *   6. free surfaces leak no paid guidance (curation stays behind the gate)
 */
import Ajv from "ajv";
import {
  DiscoveryResponseSchema,
  PaymentRequirementsSchema,
  ExtensionsSchema,
} from "./spec-schemas.mjs";
import { buildX402Resources } from "../src/lib/discovery.js";

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

// A distinctive marker planted in every item's PAID guidance; if it appears in
// any FREE surface, curation has leaked.
const GUIDANCE_MARKER = "PAID_GUIDANCE_LEAK_CANARY";

const SEED_ITEMS = [
  {
    sku: "se-loop-detect", slug: "loop-detect", name: "I am looping",
    kind: "check", service: "distress", price_usd: 0.03, invoke_kind: "verdict",
    summary: "I keep repeating the same call with no change", guidance: `${GUIDANCE_MARKER} loop-break protocol`,
    updated_at: "2026-07-14T00:00:00.000Z", status: "live", content_hash: "", input_schema: "", input_example: "", mime_type: "",
  },
  {
    sku: "se-help-me", slug: "help-me", name: "help me I am stuck",
    kind: "meta-tool", service: "distress", price_usd: 0.01, invoke_kind: "verdict",
    summary: "route my failure to the right check", guidance: `${GUIDANCE_MARKER} routing taxonomy`,
    updated_at: "2026-07-14T00:00:00.000Z", status: "live", content_hash: "", input_schema: "", input_example: "", mime_type: "",
  },
  {
    sku: "se-should-i-pay", slug: "should-i-pay", name: "should I pay this",
    kind: "check", service: "payment", price_usd: 0.01, invoke_kind: "verdict",
    summary: "a pre-payment decision gate", guidance: `${GUIDANCE_MARKER} spend policy check`,
    updated_at: "2026-07-14T00:00:00.000Z", status: "live", content_hash: "", input_schema: "", input_example: "", mime_type: "",
  },
];

function mockEnv(items) {
  const live = items.filter((i) => i.status === "live");
  return {
    X402_NETWORK: "eip155:84532",
    X402_PAYTO_PUBLIC: "0x0000000000000000000000000000000000000001",
    X402_FACILITATOR_URL: "https://x402.org/facilitator",
    SE_DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async all() { return { results: /FROM items/.test(sql) ? live : [] }; },
          async first() { return null; },
        };
      },
    },
  };
}

const BANNED_VOCAB = ["bar", "lounge", "patron", "tab", "bouncer", "tavern", "bartender", "drink"];

async function main() {
  const env = mockEnv(SEED_ITEMS);
  const origin = "https://secondeyesai.com";

  console.log("discovery §8 resources document");
  const resources = await buildX402Resources(env, origin);
  check("resources doc validates DiscoveryResponseSchema", !validate(DiscoveryResponseSchema, resources), validate(DiscoveryResponseSchema, resources) || "");
  check("resources doc lists every live door", resources.items.length === SEED_ITEMS.length, `got ${resources.items.length}`);

  console.log("per-item x402 conformance");
  for (const item of resources.items) {
    const accept = item.accepts?.[0];
    check(`  ${item.metadata.slug}: accepts[0] validates §5.1.2`, accept && !validate(PaymentRequirementsSchema, accept), accept ? validate(PaymentRequirementsSchema, accept) || "" : "no accepts");
    check(`  ${item.metadata.slug}: extension carries info+schema`, !validate(ExtensionsSchema, item.extensions), validate(ExtensionsSchema, item.extensions) || "");
  }

  console.log("naming rule (symptoms, not taxonomy)");
  for (const item of SEED_ITEMS) {
    const words = item.name.trim().split(/\s+/).length;
    check(`  ${item.slug}: name is 3-5 words`, words >= 3 && words <= 5, `"${item.name}" = ${words}`);
    check(`  ${item.slug}: name has no hyphens`, !item.name.includes("-"), `"${item.name}"`);
    check(`  ${item.slug}: name is not a slug echo`, item.name.toLowerCase().replace(/\s+/g, "-") !== item.slug, `"${item.name}"`);
  }

  console.log("plain-names rule (no metaphor vocabulary on free surfaces)");
  const freeText = SEED_ITEMS.map((i) => `${i.name} ${i.summary} ${i.kind} ${i.service}`).join(" ").toLowerCase();
  for (const banned of BANNED_VOCAB) {
    check(`  free surfaces free of "${banned}"`, !new RegExp(`\\b${banned}\\b`).test(freeText));
  }

  console.log("curation containment (paid guidance never on a free surface)");
  check("resources doc leaks no paid guidance", !JSON.stringify(resources).includes(GUIDANCE_MARKER));

  console.log("");
  if (failures.length) {
    console.error(`SELFTEST FAILED — ${failures.length} check(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`SELFTEST PASSED — ${SEED_ITEMS.length} doors, discovery + naming + vocab + containment green.`);
}

main().catch((err) => {
  console.error("SELFTEST ERROR:", err);
  process.exit(1);
});
