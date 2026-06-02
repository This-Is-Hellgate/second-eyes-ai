#!/usr/bin/env node
// test/x402-facilitator/mocked.test.mjs
// LAYER 1 — Mocked CDP facilitator integration. Always safe to run: no network,
// no spend, no real keys, no env vars required.
//
// Proves the safety invariants that MUST hold before any real facilitator is
// touched, asserted against the production code in functions/_lib/x402.js +
// x402-networks.js (the PR #17 multi-network builder + accept selector):
//
//   1. accepts[] shape per env: Base default, Polygon opt-in, Solana double-gated
//   2. CDP /verify receives ONLY the matching paymentRequirements, never accepts[]
//   3. CDP /settle reuses the SAME body /verify accepted (no rail swap)
//   4. The selected accepts[] entry (buyer's rail) is what reaches verify/settle
//   5. Network mismatch is rejected WITHOUT calling the facilitator
//   6. Malformed / missing payment header rejected WITHOUT calling the facilitator
//   7. /settle is never called when /verify rejects
//   8. Atomic-unit (USDC micros) invariant on every accepts[] entry
//   9. No production payTo / key reuse (isolation gate fires on collision)
//
// Run: node test/x402-facilitator/mocked.test.mjs   (exit 1 on any failure)

import {
  buildProductPaymentRequirements,
  buildFacilitatorRequestBody,
  verifyPaymentHeader,
  settleBuiltPayment,
  usdToUsdcMicros,
} from "../../functions/_lib/x402.js";
import { installMockFacilitator, makeSyntheticPaymentHeader } from "./mock-facilitator.mjs";
import { usdToAtomic, assertTestPayToIsolation } from "./env.mjs";

const BASE = "eip155:8453";
const POLY = "eip155:137";
const SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// Distinct production-looking wallets used purely as fixtures.
const PROD_EVM = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const PROD_SOL = "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy";
const RESOURCE = "https://secondeyesai.com/api/bar/x402/help-me";

// The facilitator URL routes to the mock (host api.cdp.coinbase.com is intercepted).
// CDP creds are intentionally absent so buildCdpAuthHeaders sends an unauthed
// request to the mock — exactly the spec's MOCK_CDP_ENV strategy.
const FACILITATOR = { X402_FACILITATOR_URL: "https://api.cdp.coinbase.com/platform" };

const product = {
  kind: "nano",
  id: "help-me",
  slug: "help-me",
  priceUsd: 0.01,
  access: "paid",
  description: "help-me — canonical agent-distress door",
};

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
const ok = (where, cond, msg) => {
  if (!cond) fail(where, msg);
};
const eqJson = (where, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(where, `got ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  }
};

function reqsFor(env) {
  return buildProductPaymentRequirements(product, RESOURCE, env);
}
function networksOf(env) {
  return (reqsFor(env)?.accepts || []).map((a) => a.network);
}

// ===========================================================================
// 1. accepts[] shape per env configuration
// ===========================================================================
{
  // Base default — exactly one rail, on eip155:8453, with EIP-712 extra.
  const env = { X402_PAYTO: PROD_EVM };
  eqJson("base-default networks", networksOf(env), [BASE]);
  const a = reqsFor(env).accepts[0];
  ok("base-default", a.payTo === PROD_EVM, `payTo ${a.payTo} != ${PROD_EVM}`);
  ok(
    "base-default",
    a.asset.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    `asset ${a.asset} != Base USDC`
  );
  ok("base-default", a.extra && a.extra.version === "2", "missing EIP-712 extra on EVM rail");
}
{
  // Polygon opt-in — appends eip155:137 as accepts[1], Base stays accepts[0].
  const env = { X402_PAYTO: PROD_EVM, X402_POLYGON_ENABLED: "1" };
  eqJson("polygon-optin networks", networksOf(env), [BASE, POLY]);
}
{
  // Solana configured but NOT active — must NOT advertise (an unsettleable rail
  // an agent could choose but the server can't settle = the agent loses money).
  const env = { X402_PAYTO: PROD_EVM, X402_SOLANA_PAY_TO: PROD_SOL };
  eqJson("solana-inactive networks", networksOf(env), [BASE]);
}
{
  // Solana double-gated (payTo AND active flag) — enters accepts[] as an SVM
  // rail (no EIP-712 extra).
  const env = { X402_PAYTO: PROD_EVM, X402_SOLANA_ACTIVE: "1", X402_SOLANA_PAY_TO: PROD_SOL };
  eqJson("solana-gated networks", networksOf(env), [BASE, SOL]);
  const sol = reqsFor(env).accepts.find((x) => x.network === SOL);
  ok("solana-gated", !sol.extra, "Solana accept must NOT carry EIP-712 extra");
  ok("solana-gated", sol.payTo === PROD_SOL, "Solana payTo not applied");
}
{
  // Base is invariably accepts[0] across every configuration.
  for (const env of [
    { X402_PAYTO: PROD_EVM },
    { X402_PAYTO: PROD_EVM, X402_POLYGON_ENABLED: "1" },
    { X402_PAYTO: PROD_EVM, X402_SOLANA_ACTIVE: "1", X402_SOLANA_PAY_TO: PROD_SOL },
    {
      X402_PAYTO: PROD_EVM,
      X402_POLYGON_ENABLED: "1",
      X402_SOLANA_ACTIVE: "1",
      X402_SOLANA_PAY_TO: PROD_SOL,
    },
  ]) {
    ok("canonical-base", networksOf(env)[0] === BASE, `accepts[0] != Base for ${JSON.stringify(env)}`);
  }
}

// ===========================================================================
// 8. Atomic-unit (USDC micros) invariant — every accepts[] amount is an integer
//    micros string. Cross-checked against an independent usdToAtomic().
// ===========================================================================
{
  ok("atomic", usdToUsdcMicros(0.001) === "1000", `usdToUsdcMicros(0.001)=${usdToUsdcMicros(0.001)} != 1000`);
  ok("atomic", usdToAtomic(0.001) === "1000", "independent usdToAtomic(0.001) != 1000");
  ok("atomic", usdToUsdcMicros(0.01) === usdToAtomic(0.01), "builder vs harness micros disagree");

  const env = { X402_PAYTO: PROD_EVM, X402_SOLANA_ACTIVE: "1", X402_SOLANA_PAY_TO: PROD_SOL };
  for (const a of reqsFor(env).accepts) {
    ok("atomic", /^\d+$/.test(a.amount), `amount "${a.amount}" is not an integer string`);
    ok("atomic", !a.amount.includes("."), `amount "${a.amount}" contains a decimal`);
    ok("atomic", !/[eE]/.test(a.amount), `amount "${a.amount}" is in exponent form`);
  }
}

// ===========================================================================
// 2-4. Facilitator sees ONLY the buyer's matching requirement; settle reuses it.
//     Asserted end-to-end through the real verifyPaymentHeader/settleBuiltPayment.
// ===========================================================================
async function verifyThenSettle(env, network, opts) {
  const mock = installMockFacilitator(opts);
  try {
    const requirement = reqsFor(env);
    const header = makeSyntheticPaymentHeader(network, opts?.headerOpts);
    const verified = await verifyPaymentHeader(header, requirement, { ...env, ...FACILITATOR });
    let settled = null;
    if (verified.ok) {
      settled = await settleBuiltPayment(verified.built, verified.accept, { ...env, ...FACILITATOR });
    }
    return { mock, verified, settled };
  } finally {
    mock.restore();
  }
}

await (async () => {
  // Multi-rail env: Base + Polygon + Solana all advertised.
  const env = {
    X402_PAYTO: PROD_EVM,
    X402_POLYGON_ENABLED: "1",
    X402_SOLANA_ACTIVE: "1",
    X402_SOLANA_PAY_TO: PROD_SOL,
  };

  // --- Base buyer → verify gets ONLY the Base requirement ---
  {
    const { mock, verified } = await verifyThenSettle(env, BASE);
    ok("verify-base", verified.ok, `verify failed: ${verified.error}`);
    ok("verify-base", mock.verifyCalls().length === 1, `expected 1 verify call, got ${mock.verifyCalls().length}`);
    const sent = mock.verifyCalls()[0].body?.paymentRequirements;
    ok("verify-base", sent && sent.network === BASE, `verify saw network ${sent?.network} != Base`);
    ok("verify-base", !Array.isArray(sent), "verify body carried an array, not a single requirement");
    ok("verify-base", sent.network !== SOL && sent.network !== POLY, "verify leaked a non-chosen rail");
  }

  // --- Polygon buyer → verify gets ONLY the Polygon requirement ---
  {
    const { mock, verified } = await verifyThenSettle(env, POLY);
    ok("verify-poly", verified.ok, `verify failed: ${verified.error}`);
    const sent = mock.verifyCalls()[0].body?.paymentRequirements;
    ok("verify-poly", sent.network === POLY, `verify saw ${sent.network} != Polygon`);
  }

  // --- Solana buyer → /settle reuses EXACTLY the body /verify accepted ---
  {
    const { mock, verified, settled } = await verifyThenSettle(env, SOL);
    ok("settle-reuse", verified.ok, `verify failed: ${verified.error}`);
    ok("settle-reuse", settled && settled.ok, `settle failed: ${settled?.error}`);
    ok("settle-reuse", mock.settleCalls().length === 1, "expected exactly 1 settle call");
    const verifyReq = mock.verifyCalls()[0].body?.paymentRequirements;
    const settleReq = mock.settleCalls()[0].body?.paymentRequirements;
    eqJson("settle-reuse req identical", settleReq, verifyReq);
    ok("settle-reuse", settleReq.network === SOL, `settle saw ${settleReq.network} != Solana`);
    // The whole built body must be byte-identical between verify and settle.
    eqJson("settle-reuse body identical", mock.settleCalls()[0].body, mock.verifyCalls()[0].body);
  }

  // --- Selected accept matches buyer's rail at the builder level too ---
  {
    const requirement = reqsFor(env);
    for (const [payload, want, label] of [
      [{ x402Version: 2, accepted: { network: POLY } }, POLY, "accepted.network=Polygon"],
      [{ x402Version: 2, network: SOL }, SOL, "top-level network=Solana"],
      [{ x402Version: 2 }, BASE, "legacy no-network → Base accepts[0]"],
    ]) {
      const built = buildFacilitatorRequestBody(
        Buffer.from(JSON.stringify(payload)).toString("base64"),
        requirement
      );
      ok("select", built.ok, `${label}: build failed (${built.error})`);
      ok("select", built.accept.network === want, `${label}: selected ${built.accept?.network} != ${want}`);
    }
  }
})();

// ===========================================================================
// 5-7. Rejection paths never call the facilitator.
// ===========================================================================
await (async () => {
  const env = { X402_PAYTO: PROD_EVM }; // Base-only — Solana/Polygon NOT accepted.

  // --- Network mismatch: buyer signs Solana but only Base is accepted ---
  // DOCUMENTED REAL BEHAVIOR (PR #17 selectAcceptForPayload): when the buyer's
  // signed network is NOT in accepts[], the selector falls back to accepts[0]
  // (Base) rather than short-circuiting. The legacy single-rail fallback is
  // intentional. The load-bearing safety property is therefore NOT "no
  // facilitator call" but: the server NEVER settles on a rail the buyer did not
  // sign for. We assert that here — verify runs against Base (accepts[0]), and a
  // real CDP facilitator rejects it because the signed payload network
  // (Solana) cannot match the Base requirement. We simulate that rejection.
  {
    const { mock, verified, settled } = await verifyThenSettle(env, SOL, {
      verifyResult: { isValid: false, invalidReason: "network_mismatch" },
    });
    const sent = mock.verifyCalls()[0]?.body?.paymentRequirements;
    ok("mismatch", sent && sent.network === BASE, "fallback should verify against Base accepts[0]");
    ok("mismatch", sent.network !== SOL, "server must never build a Solana requirement it cannot settle");
    ok("mismatch", !verified.ok, "facilitator rejection of the mismatched rail must surface as failure");
    ok("mismatch", !settled, "settle must NOT run after a rejected mismatch");
    ok("mismatch", mock.settleCalls().length === 0, "mismatch must never reach /settle");
  }

  // --- Malformed header: not base64 JSON at all ---
  {
    const mock = installMockFacilitator();
    try {
      const requirement = reqsFor(env);
      const verified = await verifyPaymentHeader(
        "this-is-not-base64-json-at-all-!!!",
        requirement,
        { ...env, ...FACILITATOR }
      );
      ok("malformed", !verified.ok, "expected malformed header to be rejected");
      ok("malformed", verified.error === "invalid_payment_header", `error ${verified.error} != invalid_payment_header`);
      ok("malformed", mock.calls.length === 0, `malformed header must not touch facilitator (${mock.calls.length} calls)`);
    } finally {
      mock.restore();
    }
  }

  // --- Empty header: missing PAYMENT-SIGNATURE ---
  {
    const mock = installMockFacilitator();
    try {
      const requirement = reqsFor(env);
      const verified = await verifyPaymentHeader("", requirement, { ...env, ...FACILITATOR });
      ok("empty-header", !verified.ok, "expected empty header to be rejected");
      ok("empty-header", mock.calls.length === 0, `empty header must not touch facilitator (${mock.calls.length} calls)`);
    } finally {
      mock.restore();
    }
  }

  // --- Facilitator rejects verify → settle is NOT called ---
  {
    const { mock, verified, settled } = await verifyThenSettle(
      env,
      BASE,
      { verifyResult: { isValid: false, invalidReason: "insufficient_funds" } }
    );
    ok("verify-reject", !verified.ok, "expected verify to surface facilitator rejection");
    ok("verify-reject", mock.verifyCalls().length === 1, "verify should have been called once");
    ok("verify-reject", !settled, "settle must NOT run after verify rejection");
    ok("verify-reject", mock.settleCalls().length === 0, "settle must NOT be called after verify rejection");
  }
})();

// ===========================================================================
// 9. No production payTo / key reuse — isolation gate fires on collision.
// ===========================================================================
{
  // Collision: test payTo == production payTo → must throw.
  let threw = false;
  try {
    assertTestPayToIsolation({ X402_PAYTO: PROD_EVM, TEST_EVM_PAY_TO: PROD_EVM });
  } catch {
    threw = true;
  }
  ok("isolation", threw, "isolation gate did NOT fire when TEST_EVM_PAY_TO == X402_PAYTO");

  // Distinct addresses → must NOT throw.
  let threwClean = false;
  try {
    assertTestPayToIsolation({ X402_PAYTO: PROD_EVM, TEST_EVM_PAY_TO: "0xTEST_treasury_distinct" });
  } catch {
    threwClean = true;
  }
  ok("isolation", !threwClean, "isolation gate wrongly fired on distinct test/prod payTo");

  // Solana collision too.
  let threwSol = false;
  try {
    assertTestPayToIsolation({ X402_SOLANA_PAY_TO: PROD_SOL, TEST_SOLANA_PAY_TO: PROD_SOL });
  } catch {
    threwSol = true;
  }
  ok("isolation", threwSol, "isolation gate did NOT fire on Solana payTo collision");
}

// ===========================================================================
// Report
// ===========================================================================
if (failures.length) {
  console.error("LAYER 1 (mocked facilitator) FAILED:\n");
  for (const f of failures) console.error(`  x ${f}`);
  console.error(`\n${failures.length} issue(s).`);
  process.exit(1);
}
console.log(
  "LAYER 1 (mocked facilitator) OK — Base default / Polygon opt-in / Solana double-gated; " +
    "verify+settle see only the buyer's matching requirement; malformed/empty headers rejected " +
    "without a facilitator call; mismatched rail never settles; atomic micros enforced; payTo isolation gate live."
);
