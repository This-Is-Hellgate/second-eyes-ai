#!/usr/bin/env node
// test/x402-facilitator/settlement.test.mjs
// LAYER 3 — LIVE SETTLEMENT (real testnet USDC). Triple-gated. DEFAULT: SKIPPED.
//
// This is the only layer that spends. It is the release-gate ritual run by an
// operator before flipping a network active in production — NOT a CI check.
//
// Gates (ALL must hold or the layer refuses to spend):
//   1. RUN_X402_SETTLEMENT_TESTS === "1"               (master switch, default off)
//   2. MAX_TEST_SPEND_USD set and <= $5                (per-run cap, default $0.25)
//   3. Per-network TEST_* testnet credentials present  (no creds → that rail skips)
//   4. assertTestPayToIsolation()                      (test payTo != production payTo)
//   5. assertTestKeyIsolation()                        (test key != production key)
//   6. Mainnet facilitator URL requires ALLOW_MAINNET_SETTLEMENT="I_UNDERSTAND"
//
// Each settlement spends $0.001 testnet USDC. The suite is the gate described in
// the harness README: 3 consecutive green Amoy/Devnet runs before activation.
//
// Run (operator, testnet wallets only):
//   export RUN_X402_SETTLEMENT_TESTS=1
//   export MAX_TEST_SPEND_USD=0.05
//   export TEST_EVM_PRIVATE_KEY=0x...        # NEVER a mainnet-funded key
//   export TEST_EVM_PAY_TO=0x...             # MUST differ from X402_PAYTO
//   export TEST_FACILITATOR_URL_BASE_SEPOLIA=https://api.cdp.coinbase.com/platform
//   node test/x402-facilitator/settlement.test.mjs

import {
  settlementAllowed,
  mainnetSettlementAllowed,
  spendCapUsd,
  usdToAtomic,
  assertTestPayToIsolation,
  assertTestKeyIsolation,
  facilitatorUrlFor,
  looksLikeMainnetUrl,
  TESTNETS,
} from "./env.mjs";
import {
  buildProductPaymentRequirements,
  verifyPaymentHeader,
  settleBuiltPayment,
} from "../../functions/_lib/x402.js";

const env = process.env;

// ---- Gate 1: master switch (default skip) --------------------------------
if (!settlementAllowed(env)) {
  console.log(
    [
      "LAYER 3 (live settlement) SKIPPED — RUN_X402_SETTLEMENT_TESTS != \"1\".",
      "This is the safe default. This layer is the ONLY one that spends real testnet",
      "USDC and is meant to be run by an operator as a pre-activation gate, never in CI.",
      "To enable, see test/x402-facilitator/README.md (triple-gated, $5 hard cap).",
    ].join("\n")
  );
  process.exit(0);
}

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);

// ---- Gate 2: spend cap (throws if invalid or > $5) -----------------------
let cap;
try {
  cap = spendCapUsd(env);
} catch (e) {
  console.error(`LAYER 3 ABORTED — ${e.message}`);
  process.exit(1);
}

// ---- Gates 4 & 5: wallet + key isolation (throw on collision) ------------
try {
  assertTestPayToIsolation(env);
  assertTestKeyIsolation(env);
} catch (e) {
  console.error(`LAYER 3 ABORTED — isolation gate: ${e.message}`);
  process.exit(1);
}

const PER_TEST_USD = 0.001;
const PER_TEST_ATOMIC = usdToAtomic(PER_TEST_USD); // "1000"

// Per-rail plan. EVM rails reuse TEST_EVM_PRIVATE_KEY; Solana is gated+unconfirmed.
const rails = [
  {
    key: "base-sepolia",
    label: "Base Sepolia",
    kind: "evm",
    enabled: !!(env.TEST_EVM_PRIVATE_KEY && env.TEST_EVM_PAY_TO && env.TEST_FACILITATOR_URL_BASE_SEPOLIA),
    payTo: env.TEST_EVM_PAY_TO,
    privateKey: env.TEST_EVM_PRIVATE_KEY,
  },
  {
    key: "polygon-amoy",
    label: "Polygon Amoy",
    kind: "evm",
    enabled: !!(env.TEST_EVM_PRIVATE_KEY && env.TEST_EVM_PAY_TO && env.TEST_FACILITATOR_URL_POLYGON_AMOY),
    payTo: env.TEST_EVM_PAY_TO,
    privateKey: env.TEST_EVM_PRIVATE_KEY,
  },
  {
    key: "solana-devnet",
    label: "Solana Devnet",
    kind: "svm",
    enabled: !!(env.TEST_SOLANA_SECRET_KEY && env.TEST_SOLANA_PAY_TO && env.TEST_FACILITATOR_URL_SOLANA_DEVNET),
    payTo: env.TEST_SOLANA_PAY_TO,
    secretKey: env.TEST_SOLANA_SECRET_KEY,
  },
];

const active = rails.filter((r) => r.enabled);
if (active.length === 0) {
  console.log(
    "LAYER 3 enabled but NO rail has full testnet credentials — nothing to settle. " +
      "Set TEST_EVM_PRIVATE_KEY + TEST_EVM_PAY_TO + TEST_FACILITATOR_URL_* for the rail you are gating."
  );
  process.exit(0);
}

// Budget: cap total run spend. Each rail spends PER_TEST_USD once here.
const projected = active.length * PER_TEST_USD;
if (projected > cap) {
  console.error(
    `LAYER 3 ABORTED — projected spend $${projected.toFixed(3)} exceeds MAX_TEST_SPEND_USD $${cap}.`
  );
  process.exit(1);
}

const product = {
  kind: "nano",
  id: "x402-settlement-probe",
  slug: "x402-settlement-probe",
  priceUsd: PER_TEST_USD,
  description: "x402 settlement probe — $0.001 testnet USDC pre-activation gate",
};

console.log(
  `LAYER 3 (live settlement) — ${active.length} rail(s), $${PER_TEST_USD} each, cap $${cap}.\n`
);

const { signEvmPayment, signSolanaPayment } = await import("./signers.mjs");

let spent = 0;
for (const rail of active) {
  const url = facilitatorUrlFor(env, rail.key);

  // ---- Gate 6: mainnet URL requires the awkward explicit opt-in ----------
  if (looksLikeMainnetUrl(url) && !mainnetSettlementAllowed(env)) {
    fail(rail.label, `facilitator URL looks like mainnet (${url}) — set ALLOW_MAINNET_SETTLEMENT="I_UNDERSTAND" to permit`);
    console.log(`  x ${rail.label}: refused (mainnet URL, not opted in)`);
    continue;
  }
  if (spent + PER_TEST_USD > cap) {
    console.log(`  - ${rail.label}: skipped, would exceed spend cap`);
    continue;
  }

  const testnet = TESTNETS[rail.key];
  // Build a requirement targeting THIS testnet rail + the test payTo. We build a
  // single-accept requirement so the signed rail is unambiguous.
  const requirement = buildProductPaymentRequirements(product, "https://secondeyesai.com/api/bar/x402/help-me", {
    X402_PAYTO: rail.payTo,
  });
  // Override accept to the testnet network + asset (production builder emits
  // mainnet ids; Layer 3 deliberately targets testnets).
  requirement.accepts = [
    {
      ...requirement.accepts[0],
      network: testnet.network,
      asset: testnet.asset,
      payTo: rail.payTo,
    },
  ];
  const accept = requirement.accepts[0];
  const settleEnv = { ...env, X402_FACILITATOR_URL: url };

  try {
    if (rail.kind === "evm") {
      const header = await signEvmPayment({
        privateKey: rail.privateKey,
        accept,
        network: testnet.network,
        payTo: rail.payTo,
        amountAtomic: PER_TEST_ATOMIC,
      });
      const verified = await verifyPaymentHeader(header, requirement, settleEnv);
      if (!verified.ok) {
        fail(rail.label, `verify failed: ${verified.error}`);
        console.log(`  x ${rail.label}: verify failed (${verified.error})`);
        continue;
      }
      const settled = await settleBuiltPayment(verified.built, verified.accept, settleEnv);
      if (!settled.ok) {
        fail(rail.label, `settle failed: ${settled.error}`);
        console.log(`  x ${rail.label}: settle failed (${settled.error})`);
        continue;
      }
      spent += PER_TEST_USD;
      console.log(`  ok ${rail.label}: settled, tx ${settled.receipt?.transaction || "(no hash)"}`);
    } else {
      // Solana: scaffolded + unconfirmed per PR #17. Record, do not assert pass.
      const scaffold = await signSolanaPayment({
        secretKey: rail.secretKey,
        network: testnet.network,
        payTo: rail.payTo,
        amountAtomic: PER_TEST_ATOMIC,
        rpcUrl: env.SOLANA_DEVNET_RPC_URL,
      });
      console.log(`  - ${rail.label}: ${scaffold.note}`);
    }
  } catch (e) {
    fail(rail.label, `exception: ${e.message}`);
    console.log(`  x ${rail.label}: ${e.message}`);
  }
}

console.log(`\nLayer 3 spend this run: ~$${spent.toFixed(3)} (cap $${cap}).`);

if (failures.length) {
  console.error("\nLAYER 3 (live settlement) FAILED:\n");
  for (const f of failures) console.error(`  x ${f}`);
  console.error(`\n${failures.length} issue(s). Do NOT activate a rail that has not settled cleanly 3x.`);
  process.exit(1);
}
console.log("\nLAYER 3 (live settlement) OK — every credentialed EVM rail verified + settled on testnet.");
