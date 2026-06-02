#!/usr/bin/env node
/**
 * External-payer signal smoke suite — no network, no spend, no DB binding.
 * Validates known_test_payers exclusion and external-payer detection against a
 * tiny in-memory stub of the D1 access_grants table.
 *
 *   node scripts/external-payer-smoke.mjs
 */

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name}${extra ? "  — " + extra : ""}`);
    fail++;
  }
}

const CANARY = "0x180f6E73f7c866e5fc9547c8a3f5cdE9411904C2";
const PAYTO = "0xFb8915074cC941f5Ab95E6001c45287b8EeC4427";
const EXTERNAL_A = "0x028bAbcDeF0123456789aBCdef0123456789'4Cbb".replace("'", "");
const EXTERNAL_B = "0x9999000011112222333344445555666677778888";

/** Minimal env.DB stub: only honors the one SELECT getExternalPayerSignal issues. */
function stubDB(grants) {
  return {
    DB: {
      prepare() {
        return {
          async all() {
            // Mirror the query's ORDER BY created_at ASC + non-null filter.
            const rows = grants
              .filter((g) => g.payer_ref && g.tx_ref)
              .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
            return { results: rows };
          },
        };
      },
    },
  };
}

const { getKnownPayers, isKnownPayer, normalizePayer, maskPayer } = await import(
  "../functions/_lib/lounge/known-payers.js"
);
const { getExternalPayerSignal } = await import("../functions/_lib/lounge/payment-proof.js");

console.log("\n[1] known-payers defaults + exclusion");
{
  const known = getKnownPayers({});
  check("default set includes canary + payTo", known.size === 2);
  check("canary recognized (case-insensitive)", isKnownPayer(CANARY.toUpperCase(), {}));
  check("payTo recognized", isKnownPayer(PAYTO, {}));
  check("external wallet NOT known", !isKnownPayer(EXTERNAL_A, {}));
  check("null ref not known", !isKnownPayer(null, {}));
}

console.log("\n[2] env-driven KNOWN_TEST_PAYERS extension");
{
  const env = { KNOWN_TEST_PAYERS: `${EXTERNAL_A}, ${EXTERNAL_B}` };
  check("env adds two payers to defaults", getKnownPayers(env).size === 4);
  check("env wallet now treated as known", isKnownPayer(EXTERNAL_A, env));
  const strict = getKnownPayers({ KNOWN_TEST_PAYERS: CANARY, KNOWN_TEST_PAYERS_STRICT: "1" });
  check("strict mode drops defaults", strict.size === 1 && strict.has(normalizePayer(CANARY)));
}

console.log("\n[3] signal — only known payers settled");
{
  const env = stubDB([
    { id: "g1", payer_ref: CANARY, tx_ref: "0xtx1", created_at: "2026-01-01T00:00:00Z" },
    { id: "g2", payer_ref: PAYTO, tx_ref: "0xtx2", created_at: "2026-01-02T00:00:00Z" },
  ]);
  const sig = await getExternalPayerSignal(env);
  check("no external signal", sig.external_buyer_signal === false);
  check("zero distinct external payers", sig.external_distinct_payers === 0);
  check("first_external null", sig.first_external_payer_seen === null);
  check("known_test_payers_configured = 2", sig.known_test_payers_configured === 2);
}

console.log("\n[4] signal — a new external payer appears");
{
  const env = stubDB([
    { id: "g1", payer_ref: CANARY, tx_ref: "0xtx1", created_at: "2026-01-01T00:00:00Z" },
    { id: "g2", payer_ref: EXTERNAL_A, tx_ref: "0xtxEXT1", created_at: "2026-01-03T00:00:00Z" },
    { id: "g3", payer_ref: EXTERNAL_A, tx_ref: "0xtxEXT2", created_at: "2026-01-04T00:00:00Z" },
    { id: "g4", payer_ref: EXTERNAL_B, tx_ref: "0xtxEXT3", created_at: "2026-01-05T00:00:00Z" },
  ]);
  const sig = await getExternalPayerSignal(env);
  check("external signal true", sig.external_buyer_signal === true);
  check("two distinct external payers", sig.external_distinct_payers === 2);
  check(
    "first external = earliest external tx (EXT1)",
    sig.first_external_payer_seen?.tx_ref === "0xtxEXT1"
  );
  check(
    "latest external = most recent external tx (EXT3)",
    sig.latest_external_settlement?.tx_ref === "0xtxEXT3"
  );
  check(
    "payer addresses are masked (no full address leaked)",
    sig.first_external_payer_seen?.payer === maskPayer(EXTERNAL_A) &&
      !String(sig.first_external_payer_seen?.payer).includes(EXTERNAL_A.slice(10, 30))
  );
}

console.log("\n[5] signal — env exclusion suppresses a payer");
{
  const env = {
    ...stubDB([
      { id: "g1", payer_ref: EXTERNAL_A, tx_ref: "0xtxEXT1", created_at: "2026-01-03T00:00:00Z" },
    ]),
    KNOWN_TEST_PAYERS: EXTERNAL_A,
  };
  const sig = await getExternalPayerSignal(env);
  check("excluded payer yields no signal", sig.external_buyer_signal === false);
  check("known count reflects env addition", sig.known_test_payers_configured === 3);
}

console.log("\n[6] no DB binding — safe empty signal");
{
  const sig = await getExternalPayerSignal({});
  check("no DB → not external", sig.external_buyer_signal === false);
  check("no DB → defaults still counted", sig.known_test_payers_configured === 2);
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
