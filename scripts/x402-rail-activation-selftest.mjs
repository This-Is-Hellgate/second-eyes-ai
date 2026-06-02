#!/usr/bin/env node
/**
 * No-spend proof that the rail ACTIVATION-RECORD gate behaves safely. This is the
 * regression test for the failed Polygon canary: the env flag X402_POLYGON_ENABLED
 * must NOT, on its own, put eip155:137 into accepts[]. A non-Base rail enters
 * accepts[] only when the flag is set AND a valid activation record proves
 * settlement (Amoy Layer 3 >=3x + a documented mainnet smoke tx), or an explicit
 * emergency override is in force.
 *
 * Pure — no network, no money. Exit 1 on any failure (CI-friendly), mirroring
 * scripts/x402-multinetwork-selftest.mjs.
 */

import {
  acceptedNetworkIds,
  x402ConfigWarnings,
  railStates,
  plannedNetworks,
} from "../functions/_lib/x402-networks.js";
import {
  resolvePolygonActivation,
  MIN_AMOY_LAYER3_PASSES,
  POLYGON_EMERGENCY_OVERRIDE_SENTINEL,
} from "../functions/_lib/x402-rail-activation.js";

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
const eq = (where, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(where, `got ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  }
};
const ok = (where, cond, msg) => {
  if (!cond) fail(where, msg);
};

const BASE = "eip155:8453";
const POLY = "eip155:137";

const recordEnv = (rec) => JSON.stringify(rec);
const VALID_RECORD = {
  activated: true,
  amoy_layer3_passes: MIN_AMOY_LAYER3_PASSES,
  mainnet_smoke_tx: "0xdeadbeef",
};

const polyState = (env) => railStates(env).find((r) => r.key === "polygon");

// --- 1. The canary regression: flag ALONE never advertises Polygon ---
{
  const env = { X402_PAYTO: "0xW", X402_POLYGON_ENABLED: "1" };
  eq("flag-alone accepts", acceptedNetworkIds(env), [BASE]);
  ok(
    "flag-alone not proven",
    resolvePolygonActivation(env).proven === false,
    "flag alone must not be proven"
  );
  ok(
    "flag-alone state unproven",
    polyState(env).state === "unproven",
    `expected unproven, got ${polyState(env).state}`
  );
  const warns = x402ConfigWarnings(env).map((w) => w.code);
  ok(
    "flag-alone warns",
    warns.includes("polygon_enabled_without_activation_record"),
    `expected record warning, got ${warns.join(",")}`
  );
}

// --- 2. The checked-in default file keeps Polygon disabled ---
{
  // No env record, no override → falls back to config/x402-rail-activations.json,
  // which ships activated:false. Even with the flag on, Polygon stays out.
  const env = { X402_PAYTO: "0xW", X402_POLYGON_ENABLED: "1" };
  const act = resolvePolygonActivation(env);
  eq("file source", act.recordSource, "file");
  ok("file not proven", act.proven === false, "checked-in file must default to NOT proven");
  ok(
    "file blocker",
    act.reasons.includes("record_not_activated"),
    `expected record_not_activated, got ${act.reasons.join(",")}`
  );
}

// --- 3. Flag + valid env record → Polygon enters accepts[] after Base ---
{
  const env = {
    X402_PAYTO: "0xW",
    X402_POLYGON_ENABLED: "1",
    X402_POLYGON_ACTIVATION_RECORD: recordEnv(VALID_RECORD),
  };
  eq("proven accepts", acceptedNetworkIds(env), [BASE, POLY]);
  const act = resolvePolygonActivation(env);
  ok("proven true", act.proven === true, "valid record should be proven");
  eq("proven source", act.source, "record");
  eq("proven recordSource", act.recordSource, "env");
  eq("proven state", polyState(env).state, "active");
  eq("proven no warnings", x402ConfigWarnings(env).length, 0);
}

// --- 4. A valid record but flag OFF → Polygon still NOT advertised ---
{
  const env = { X402_PAYTO: "0xW", X402_POLYGON_ACTIVATION_RECORD: recordEnv(VALID_RECORD) };
  eq("record-no-flag accepts", acceptedNetworkIds(env), [BASE]);
  eq("record-no-flag state", polyState(env).state, "disabled");
  // A proven record without the flag is not a misconfiguration → no warning.
  eq("record-no-flag warnings", x402ConfigWarnings(env).length, 0);
}

// --- 5. Each individual record defect blocks activation ---
{
  const cases = [
    [{ activated: false, amoy_layer3_passes: 3, mainnet_smoke_tx: "0x1" }, "record_not_activated"],
    [{ activated: true, amoy_layer3_passes: 2, mainnet_smoke_tx: "0x1" }, "amoy_layer3_below_threshold"],
    [{ activated: true, amoy_layer3_passes: 3 }, "missing_mainnet_smoke_tx"],
    [{ activated: true, amoy_layer3_passes: 3, mainnet_smoke_tx: "  " }, "missing_mainnet_smoke_tx"],
    [{ activated: true, amoy_layer3_passes: "3", mainnet_smoke_tx: "0x1" }, "amoy_layer3_below_threshold"],
  ];
  for (const [rec, wantBlocker] of cases) {
    const env = {
      X402_PAYTO: "0xW",
      X402_POLYGON_ENABLED: "1",
      X402_POLYGON_ACTIVATION_RECORD: recordEnv(rec),
    };
    eq(`defect ${wantBlocker} accepts`, acceptedNetworkIds(env), [BASE]);
    const act = resolvePolygonActivation(env);
    ok(`defect ${wantBlocker} not proven`, act.proven === false, "defective record must not prove");
    ok(
      `defect ${wantBlocker} reason`,
      act.reasons.includes(wantBlocker),
      `expected ${wantBlocker}, got ${act.reasons.join(",")}`
    );
  }
}

// --- 6. A malformed env record is a HARD invalid — never falls back to the file ---
{
  const env = {
    X402_PAYTO: "0xW",
    X402_POLYGON_ENABLED: "1",
    X402_POLYGON_ACTIVATION_RECORD: "{not json",
  };
  const act = resolvePolygonActivation(env);
  ok("malformed not proven", act.proven === false, "malformed record must not prove");
  eq("malformed recordSource", act.recordSource, "env");
  ok(
    "malformed reason",
    act.reasons.includes("env_record_invalid_json"),
    `expected env_record_invalid_json, got ${act.reasons.join(",")}`
  );
  eq("malformed accepts", acceptedNetworkIds(env), [BASE]);
}

// --- 7. Full file-shaped env record (rails.polygon) is accepted ---
{
  const env = {
    X402_PAYTO: "0xW",
    X402_POLYGON_ENABLED: "1",
    X402_POLYGON_ACTIVATION_RECORD: recordEnv({ version: 1, rails: { polygon: VALID_RECORD } }),
  };
  eq("file-shaped accepts", acceptedNetworkIds(env), [BASE, POLY]);
}

// --- 8. Emergency override advertises Polygon but stays loud ---
{
  const env = {
    X402_PAYTO: "0xW",
    X402_POLYGON_ENABLED: "1",
    X402_POLYGON_EMERGENCY_OVERRIDE: POLYGON_EMERGENCY_OVERRIDE_SENTINEL,
  };
  eq("override accepts", acceptedNetworkIds(env), [BASE, POLY]);
  const act = resolvePolygonActivation(env);
  ok("override flagged", act.emergencyOverride === true, "override must be flagged");
  eq("override source", act.source, "emergency_override");
  eq("override state", polyState(env).state, "emergency_override");
  const warns = x402ConfigWarnings(env).map((w) => w.code);
  ok(
    "override warns",
    warns.includes("polygon_emergency_override_active"),
    `expected override warning, got ${warns.join(",")}`
  );
}

// --- 9. A wrong override value is ignored (no accidental activation) ---
{
  const env = {
    X402_PAYTO: "0xW",
    X402_POLYGON_ENABLED: "1",
    X402_POLYGON_EMERGENCY_OVERRIDE: "1",
  };
  eq("wrong-override accepts", acceptedNetworkIds(env), [BASE]);
  ok(
    "wrong-override not proven",
    resolvePolygonActivation(env).emergencyOverride === false,
    "a non-sentinel override value must be ignored"
  );
}

// --- 10. planned_networks surfaces Polygon as disabled/unproven, never activatable-by-flag ---
{
  const disabled = plannedNetworks({ X402_PAYTO: "0xW" }).find((p) => p.network === POLY);
  eq("planned disabled status", disabled.status, "disabled");
  ok("planned disabled not proven", disabled.activation_proven === false, "must report not proven");

  const unproven = plannedNetworks({ X402_PAYTO: "0xW", X402_POLYGON_ENABLED: "1" }).find(
    (p) => p.network === POLY
  );
  eq("planned unproven status", unproven.status, "unproven");
}

if (failures.length) {
  console.error("x402 rail-activation self-test FAILED:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n${failures.length} issue(s).`);
  process.exit(1);
}

console.log(
  "x402 rail-activation self-test OK — Polygon flag alone never advertises; valid record (or override) required; malformed env record hard-rejects; states surfaced."
);
