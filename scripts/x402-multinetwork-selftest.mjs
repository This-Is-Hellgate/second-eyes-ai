#!/usr/bin/env node
/**
 * No-spend proof that the multi-network x402 abstraction behaves safely:
 *   - Base (eip155:8453) is ALWAYS accepts[0] and Base-only output is unchanged.
 *   - Extra rails (Polygon, Solana) append to accepts[] ONLY when their config is
 *     present and gated — never by accident.
 *   - Solana is double-gated: it needs a payTo AND an explicit active flag, so a
 *     misconfigured env can never advertise an unsettleable rail.
 *   - The facilitator request body selects the accept the BUYER signed for, so a
 *     Polygon/Solana signer is not verified against the Base accept[0].
 *
 * Pure — no network, no money, Node built-ins + repo modules only. Exit 1 on any
 * failure (CI-friendly, mirrors scripts/discovery-consistency-check.mjs style).
 */

import {
  buildProductPaymentRequirements,
  buildFacilitatorRequestBody,
} from "../functions/_lib/x402.js";
import {
  resolveActiveNetworks,
  acceptedNetworkIds,
  x402ConfigWarnings,
} from "../functions/_lib/x402-networks.js";

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
const eq = (where, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(where, `got ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  }
};

const BASE = "eip155:8453";
const POLY = "eip155:137";
const SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// After the failed canary, X402_POLYGON_ENABLED alone NO LONGER advertises Polygon.
// It also needs a valid activation record. Supply one (env form) wherever a test
// asserts Polygon is active. Dedicated gate coverage: x402-rail-activation-selftest.mjs.
const PROVEN_POLYGON_RECORD = JSON.stringify({
  activated: true,
  amoy_layer3_passes: 3,
  mainnet_smoke_tx: "0xsmoke",
});

const product = {
  kind: "nano",
  id: "help-me",
  slug: "help-me",
  priceUsd: 0.01,
  access: "paid",
  description: "help-me — canonical agent-distress door",
};
const URL_UNDER_TEST = "https://secondeyesai.com/api/bar/x402/help-me";

const accepts = (env) =>
  (buildProductPaymentRequirements(product, URL_UNDER_TEST, env)?.accepts || []).map(
    (a) => a.network
  );

// --- 1. No payTo at all → x402 not configured (null requirements) ---
{
  const req = buildProductPaymentRequirements(product, URL_UNDER_TEST, {});
  if (req !== null) fail("no-config", "expected null requirements when X402_PAYTO unset");
  eq("no-config networks", resolveActiveNetworks({}).length, 0);
}

// --- 2. Base only (current production posture) is unchanged ---
{
  const env = { X402_PAYTO: "0xBaseWallet" };
  eq("base-only accepts", accepts(env), [BASE]);
  eq("base-only ids", acceptedNetworkIds(env), [BASE]);
  const req = buildProductPaymentRequirements(product, URL_UNDER_TEST, env);
  const a = req.accepts[0];
  // EVM accept must keep its EIP-712 domain and Base USDC contract.
  if (a.asset.toLowerCase() !== "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913") {
    fail("base-only", `asset ${a.asset} != Base USDC`);
  }
  if (!a.extra || a.extra.version !== "2") fail("base-only", "missing EIP-712 extra");
}

// --- 3. Polygon appends only when enabled AND proven; Base stays accepts[0] ---
{
  // Flag alone (no activation record) must NOT advertise Polygon — the canary fix.
  eq("flag-only no record", accepts({ X402_PAYTO: "0xBaseWallet", X402_POLYGON_ENABLED: "1" }), [BASE]);

  // Flag + valid activation record → Polygon appends after Base.
  const env = {
    X402_PAYTO: "0xBaseWallet",
    X402_POLYGON_ENABLED: "1",
    X402_POLYGON_ACTIVATION_RECORD: PROVEN_POLYGON_RECORD,
  };
  eq("base+poly accepts", accepts(env), [BASE, POLY]);
  const poly = buildProductPaymentRequirements(product, URL_UNDER_TEST, env).accepts[1];
  if (poly.network !== POLY) fail("base+poly", "accepts[1] is not Polygon");
  if (!poly.extra) fail("base+poly", "Polygon accept missing EIP-712 extra (EVM rail)");
}

// --- 4. Polygon enabled (+proven) with dedicated payTo override ---
{
  const env = {
    X402_PAYTO: "0xBaseWallet",
    X402_POLYGON_ENABLED: "true",
    X402_POLYGON_PAY_TO: "0xPolyWallet",
    X402_POLYGON_ACTIVATION_RECORD: PROVEN_POLYGON_RECORD,
  };
  const poly = resolveActiveNetworks(env).find((r) => r.network.key === "polygon");
  if (!poly || poly.payTo !== "0xPolyWallet") fail("poly-override", "did not use X402_POLYGON_PAY_TO");
}

// --- 5. Solana is double-gated ---
{
  // active flag but no payTo → NOT advertised
  eq("sol active no payTo", accepts({ X402_PAYTO: "0xW", X402_SOLANA_ACTIVE: "1" }), [BASE]);
  // payTo but no active flag → NOT advertised
  eq("sol payTo no flag", accepts({ X402_PAYTO: "0xW", X402_SOLANA_PAY_TO: "SoLwallet" }), [BASE]);
  // both → advertised, and as an SVM accept (no EIP-712 extra)
  const env = { X402_PAYTO: "0xW", X402_SOLANA_ACTIVE: "1", X402_SOLANA_PAY_TO: "SoLwallet" };
  eq("sol fully gated accepts", accepts(env), [BASE, SOL]);
  const sol = buildProductPaymentRequirements(product, URL_UNDER_TEST, env).accepts.find(
    (a) => a.network === SOL
  );
  if (sol.extra) fail("sol-gated", "Solana accept must NOT carry EIP-712 extra");
  if (sol.payTo !== "SoLwallet") fail("sol-gated", "Solana payTo not applied");
}

// --- 6. Facilitator body selects the accept the buyer signed for ---
{
  const env = {
    X402_PAYTO: "0xW",
    X402_POLYGON_ENABLED: "1",
    X402_POLYGON_ACTIVATION_RECORD: PROVEN_POLYGON_RECORD,
    X402_SOLANA_ACTIVE: "1",
    X402_SOLANA_PAY_TO: "SoLwallet",
  };
  const req = buildProductPaymentRequirements(product, URL_UNDER_TEST, env);
  const header = (payload) => Buffer.from(JSON.stringify(payload)).toString("base64");

  const cases = [
    [{ x402Version: 2, accepted: { network: POLY } }, POLY, "buyer chose Polygon"],
    [{ x402Version: 2, network: SOL }, SOL, "buyer chose Solana (top-level network)"],
    [{ x402Version: 2, accepted: { network: BASE } }, BASE, "buyer chose Base"],
    [{ x402Version: 2 }, BASE, "legacy no-network signer falls back to Base accepts[0]"],
  ];
  for (const [payload, wantNetwork, label] of cases) {
    const built = buildFacilitatorRequestBody(header(payload), req);
    if (!built.ok) {
      fail("facilitator", `${label}: build failed (${built.error})`);
      continue;
    }
    if (built.accept.network !== wantNetwork) {
      fail("facilitator", `${label}: selected ${built.accept.network} != ${wantNetwork}`);
    }
    if (built.body.paymentRequirements.network !== wantNetwork) {
      fail("facilitator", `${label}: paymentRequirements.network != ${wantNetwork}`);
    }
  }
}

// --- 6b. A declared rail NOT in accepts[] is REJECTED, never routed to Base ---
{
  // Base-only env, but buyer signs for Polygon (which is NOT advertised here).
  // The old behavior fell back to accepts[0] (Base) and shipped a Polygon
  // signature to the Base verify → 402 with no receipt. It must hard-reject.
  const env = { X402_PAYTO: "0xW" }; // Base only — Polygon NOT enabled
  const req = buildProductPaymentRequirements(product, URL_UNDER_TEST, env);
  const header = (payload) => Buffer.from(JSON.stringify(payload)).toString("base64");

  const built = buildFacilitatorRequestBody(
    header({ x402Version: 2, accepted: { network: POLY } }),
    req
  );
  if (built.ok) {
    fail("hard-reject", "Polygon payload accepted against a Base-only accepts[] (should reject)");
  }
  if (built.error !== "unsupported_payment_network") {
    fail("hard-reject", `expected unsupported_payment_network, got ${built.error}`);
  }
  if (built.declaredNetwork !== POLY) {
    fail("hard-reject", `declaredNetwork should be ${POLY}, got ${built.declaredNetwork}`);
  }
  eq("hard-reject offered", built.offeredNetworks, [BASE]);

  // Top-level network form is rejected too.
  const built2 = buildFacilitatorRequestBody(header({ x402Version: 2, network: SOL }), req);
  if (built2.ok || built2.error !== "unsupported_payment_network") {
    fail("hard-reject", "top-level unknown network not rejected");
  }
}

// --- 6c. Config warnings: enabled flag without an activation record is surfaced ---
{
  // Polygon flag on, but NO activation record → flag-alone case → warn (the canary fix).
  const warns = x402ConfigWarnings({ X402_PAYTO: "0xW", X402_POLYGON_ENABLED: "1" });
  if (!warns.some((w) => w.code === "polygon_enabled_without_activation_record")) {
    fail("config-warn", "expected polygon_enabled_without_activation_record when flag set without a record");
  }
  // Clean config → no warnings.
  if (x402ConfigWarnings({ X402_PAYTO: "0xW" }).length !== 0) {
    fail("config-warn", "Base-only clean config should produce no warnings");
  }
  // Flag + valid record + payTo (reuses Base) → clean.
  if (
    x402ConfigWarnings({
      X402_PAYTO: "0xW",
      X402_POLYGON_ENABLED: "1",
      X402_POLYGON_ACTIVATION_RECORD: PROVEN_POLYGON_RECORD,
    }).length !== 0
  ) {
    fail("config-warn", "Polygon enabled WITH a valid record + Base payTo should be clean");
  }
  // Flag + valid record but NO payTo → distinct payTo warning, not the record warning.
  const noPayTo = x402ConfigWarnings({
    X402_POLYGON_ENABLED: "1",
    X402_POLYGON_ACTIVATION_RECORD: PROVEN_POLYGON_RECORD,
  });
  if (!noPayTo.some((w) => w.code === "polygon_enabled_but_inactive")) {
    fail("config-warn", "expected polygon_enabled_but_inactive when record valid but no payTo");
  }
  // Emergency override that actually advertises Polygon → loud override warning.
  const ovr = x402ConfigWarnings({
    X402_PAYTO: "0xW",
    X402_POLYGON_ENABLED: "1",
    X402_POLYGON_EMERGENCY_OVERRIDE: "I_ACCEPT_UNPROVEN_RISK",
  });
  if (!ovr.some((w) => w.code === "polygon_emergency_override_active")) {
    fail("config-warn", "expected polygon_emergency_override_active when override advertises Polygon");
  }
  // Solana active flag without a Solana payTo → warn.
  if (
    !x402ConfigWarnings({ X402_PAYTO: "0xW", X402_SOLANA_ACTIVE: "1" }).some(
      (w) => w.code === "solana_active_but_inactive"
    )
  ) {
    fail("config-warn", "expected solana_active_but_inactive when active without Solana payTo");
  }
}

// --- 7. accepts[0] is invariably Base across every configuration ---
for (const env of [
  { X402_PAYTO: "0xW" },
  { X402_PAYTO: "0xW", X402_POLYGON_ENABLED: "1" },
  { X402_PAYTO: "0xW", X402_POLYGON_ENABLED: "1", X402_POLYGON_ACTIVATION_RECORD: PROVEN_POLYGON_RECORD },
  { X402_PAYTO: "0xW", X402_SOLANA_ACTIVE: "1", X402_SOLANA_PAY_TO: "SoL" },
  {
    X402_PAYTO: "0xW",
    X402_POLYGON_ENABLED: "1",
    X402_POLYGON_ACTIVATION_RECORD: PROVEN_POLYGON_RECORD,
    X402_SOLANA_ACTIVE: "1",
    X402_SOLANA_PAY_TO: "SoL",
  },
]) {
  if (accepts(env)[0] !== BASE) fail("canonical-base", `accepts[0] != Base for env ${JSON.stringify(env)}`);
}

if (failures.length) {
  console.error("x402 multi-network self-test FAILED:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n${failures.length} issue(s).`);
  process.exit(1);
}

console.log(
  "x402 multi-network self-test OK — Base canonical accepts[0]; Polygon opt-in; Solana double-gated; facilitator selects the buyer's rail."
);
