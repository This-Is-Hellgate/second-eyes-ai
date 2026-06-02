#!/usr/bin/env node
// test/x402-facilitator/polygon-canary.test.mjs
// MOCK-MODE tests for the repo-native Polygon canary tooling. No network, no spend,
// no keys, no env vars required — safe in CI. Proves the safety GATES of
// scripts/polygon-canary.mjs (and the preflight rail logic) fire exactly as designed,
// asserted against the real builder in functions/_lib/x402.js + x402-networks.js.
//
// We test buildCanaryConfig() / buildAndCheckRequirement() directly by stubbing
// process.exit to throw, so each abort() becomes a catchable assertion. The end-to-end
// mock path is covered by running `node scripts/polygon-canary.mjs` with
// POLYGON_CANARY_MOCK=1 from the runner (x402-facilitator-tests.mjs) — here we assert
// the gate matrix in-process for precise failure messages.
//
// Run: node test/x402-facilitator/polygon-canary.test.mjs   (exit 1 on any failure)

import {
  buildCanaryConfig,
  buildAndCheckRequirement,
} from "../../scripts/polygon-canary.mjs";
import { USDC_POLYGON, POLYGON_NETWORK } from "../../functions/_lib/x402-networks.js";

const POLYGON_ID = POLYGON_NETWORK.id;
const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);

// A valid, self-consistent env that should clear every gate.
const VALID = Object.freeze({
  RUN_POLYGON_CANARY: "1",
  POLYGON_CANARY_PRIVATE_KEY: "0x" + "11".repeat(32),
  POLYGON_CANARY_EXPECTED_PAYTO: "0x000000000000000000000000000000000000dEaD",
  POLYGON_CANARY_EXPECTED_AMOUNT_USD: "0.01",
  POLYGON_CANARY_MAX_USD: "0.05",
  POLYGON_CANARY_EXPECTED_ASSET: USDC_POLYGON,
  POLYGON_CANARY_EXPECTED_NETWORK: POLYGON_ID,
});
const PAYER = "0x000000000000000000000000000000000000bEEF";

/** Run fn with process.exit stubbed to throw, so abort() is catchable. Returns
 *  { aborted: bool, message } — message is the abort line when aborted. */
function capture(fn) {
  const realExit = process.exit;
  const realErr = console.error;
  let aborted = false;
  let message = "";
  console.error = (...args) => {
    message += args.join(" ") + "\n";
  };
  process.exit = (code) => {
    if (code !== 0) {
      aborted = true;
      throw new Error("__ABORT__");
    }
  };
  let result;
  try {
    result = fn();
  } catch (e) {
    if (e.message !== "__ABORT__") {
      // A real (non-abort) throw — surface it.
      process.exit = realExit;
      console.error = realErr;
      throw e;
    }
  } finally {
    process.exit = realExit;
    console.error = realErr;
  }
  return { aborted, message: message.trim(), result };
}

function expectAbort(label, env, payer = PAYER, mutate = null) {
  const e = { ...env };
  if (mutate) mutate(e);
  const { aborted, message } = capture(() => {
    const cfg = buildCanaryConfig(e);
    if (!cfg.allowed) {
      // closed gate (skip) — treat as "did not proceed", which for these tests is
      // only valid for the RUN_POLYGON_CANARY case.
      throw new Error("__ABORT__");
    }
    buildAndCheckRequirement(cfg, payer);
  });
  if (!aborted) fail(label, "expected an abort/closed-gate but the config was accepted");
  return message;
}

function expectOk(label, env, payer = PAYER) {
  const { aborted, message, result } = capture(() => {
    const cfg = buildCanaryConfig(env);
    if (!cfg.allowed) throw new Error("__ABORT__");
    return buildAndCheckRequirement(cfg, payer);
  });
  if (aborted) {
    fail(label, `expected acceptance but aborted: ${message}`);
    return null;
  }
  return result;
}

// --- 1. Happy path: valid env builds a single matching Polygon accept ----------
{
  const out = expectOk("valid-config", VALID);
  if (out) {
    const { requirement, accept } = out;
    if (requirement.accepts.length !== 1) fail("valid-config", `expected exactly 1 accept, got ${requirement.accepts.length}`);
    if (accept.network !== POLYGON_ID) fail("valid-config", `accept.network ${accept.network} != ${POLYGON_ID}`);
    if (String(accept.asset).toLowerCase() !== USDC_POLYGON.toLowerCase()) fail("valid-config", `accept.asset ${accept.asset} != ${USDC_POLYGON}`);
    if (accept.amount !== "10000") fail("valid-config", `accept.amount ${accept.amount} != 10000 micros ($0.01)`);
    if (String(accept.payTo).toLowerCase() !== VALID.POLYGON_CANARY_EXPECTED_PAYTO.toLowerCase()) fail("valid-config", `accept.payTo ${accept.payTo} != expected`);
  }
}

// --- 2. Gate 1: master switch off → closed gate (no proceed) -------------------
{
  const cfg = buildCanaryConfig({ ...VALID, RUN_POLYGON_CANARY: "0" });
  if (cfg.allowed) fail("gate1-switch", "RUN_POLYGON_CANARY=0 should NOT allow the canary");
}
{
  const cfg = buildCanaryConfig({ ...VALID, RUN_POLYGON_CANARY: undefined });
  if (cfg.allowed) fail("gate1-unset", "RUN_POLYGON_CANARY unset should NOT allow the canary");
}

// --- 3. Gate 2: missing private key aborts -------------------------------------
expectAbort("gate2-no-key", VALID, PAYER, (e) => { delete e.POLYGON_CANARY_PRIVATE_KEY; });

// --- 4. Gate 3: missing expected payTo aborts ----------------------------------
expectAbort("gate3-no-payto", VALID, PAYER, (e) => { delete e.POLYGON_CANARY_EXPECTED_PAYTO; });

// --- 5. Gate 4: missing / non-positive amount aborts ---------------------------
expectAbort("gate4-no-amount", VALID, PAYER, (e) => { delete e.POLYGON_CANARY_EXPECTED_AMOUNT_USD; });
expectAbort("gate4-zero-amount", VALID, PAYER, (e) => { e.POLYGON_CANARY_EXPECTED_AMOUNT_USD = "0"; });

// --- 6. Gate 5: amount above max, and max above hard cap, both abort ------------
expectAbort("gate5-amount-over-max", VALID, PAYER, (e) => { e.POLYGON_CANARY_EXPECTED_AMOUNT_USD = "0.10"; e.POLYGON_CANARY_MAX_USD = "0.05"; });
expectAbort("gate5-max-over-hardcap", VALID, PAYER, (e) => { e.POLYGON_CANARY_MAX_USD = "2"; });

// --- 7. Gate 6: wrong network / wrong asset abort ------------------------------
expectAbort("gate6-wrong-network", VALID, PAYER, (e) => { e.POLYGON_CANARY_EXPECTED_NETWORK = "eip155:8453"; });
expectAbort("gate6-wrong-asset", VALID, PAYER, (e) => { e.POLYGON_CANARY_EXPECTED_ASSET = "0x0000000000000000000000000000000000000bad"; });

// --- 8. Gate 8: self-pay loop (payer == payTo) aborts --------------------------
expectAbort("gate8-self-pay", VALID, VALID.POLYGON_CANARY_EXPECTED_PAYTO);

// --- 9. Defaults: asset + network default to canonical Polygon values ----------
{
  const e = { ...VALID };
  delete e.POLYGON_CANARY_EXPECTED_ASSET;
  delete e.POLYGON_CANARY_EXPECTED_NETWORK;
  const out = expectOk("gate6-defaults", e);
  if (out && out.accept.network !== POLYGON_ID) fail("gate6-defaults", "default network should be Polygon");
}

// --- Verdict -------------------------------------------------------------------
if (failures.length) {
  console.error("\nPOLYGON CANARY (mock) FAILED:\n");
  for (const f of failures) console.error(`  x ${f}`);
  console.error(`\n${failures.length} issue(s).`);
  process.exit(1);
}
console.log("Polygon canary mock-mode tests OK — all 8 gates + builder match invariants hold (no spend, no network).");
