/**
 * Rail activation-record gate — the proof layer in front of a non-Base rail's
 * env flag.
 *
 * Why this exists: Polygon (eip155:137) was once advertised in accepts[] off the
 * X402_POLYGON_ENABLED flag alone, BEFORE Layer 3 proved the rail could actually
 * settle. The live canary then failed verification and agents could have lost
 * spend on a rail the server could not settle. The flag is necessary but no longer
 * sufficient: a non-Base rail also needs an activation RECORD attesting the
 * release-gate ritual passed (Amoy Layer 3 >=3x + a documented mainnet smoke tx),
 * per docs/x402-facilitator-testing.md.
 *
 * Two record sources, checked in priority order:
 *   1. env[X402_POLYGON_ACTIVATION_RECORD] — a JSON string (lets an operator
 *      supply/rotate the record as a Pages secret without a redeploy of the file).
 *   2. config/x402-rail-activations.json — the checked-in default (Polygon OFF).
 * The env record, when present and parseable, fully replaces the file record for
 * that rail. A present-but-unparseable env record is treated as INVALID (it does
 * not silently fall through to the file) so a typo can never accidentally relax
 * the gate.
 *
 * Emergency override: X402_POLYGON_EMERGENCY_OVERRIDE must equal the exact sentinel
 * "I_ACCEPT_UNPROVEN_RISK". It bypasses the record check entirely (still requires
 * the rail's enable flag + a payTo upstream). It is loud: callers surface it as a
 * warning, never as a clean "proven" state.
 *
 * Pure: no file I/O at runtime (the JSON is bundled via a static import), no
 * network. Mirrors the no-spend, exit-1-on-failure posture of the rest of x402.
 */

import RAIL_ACTIVATIONS from "../../config/x402-rail-activations.json" with { type: "json" };

/** Minimum consecutive Amoy Layer 3 settlements before Polygon may activate. */
export const MIN_AMOY_LAYER3_PASSES = 3;

/** The ONLY accepted emergency-override value — anything else is ignored. */
export const POLYGON_EMERGENCY_OVERRIDE_SENTINEL = "I_ACCEPT_UNPROVEN_RISK";

/** Per-rail wiring: which env vars hold the record and the emergency override. */
const RAIL_GATES = {
  polygon: {
    record_env: "X402_POLYGON_ACTIVATION_RECORD",
    override_env: "X402_POLYGON_EMERGENCY_OVERRIDE",
  },
};

function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

/** Parse the env-provided record JSON. Returns { record } or { parseError }. */
function recordFromEnv(env, recordEnvName) {
  const raw = env?.[recordEnvName];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { record: null };
  }
  try {
    const parsed = JSON.parse(raw);
    const obj = asObject(parsed);
    if (!obj) return { parseError: "env_record_not_object" };
    // Accept either the per-rail object directly, or a full file-shaped record.
    if (obj.rails && asObject(obj.rails)) return { record: obj.rails.polygon ?? null };
    return { record: obj };
  } catch {
    return { parseError: "env_record_invalid_json" };
  }
}

/** The checked-in record for a rail, or null. Frozen import — never mutated. */
function recordFromFile(railKey) {
  return asObject(RAIL_ACTIVATIONS?.rails?.[railKey]) || null;
}

/**
 * Validate a single rail's activation record. The gate is intentionally strict:
 * every condition must hold or the rail is NOT proven.
 *
 * A record proves activation when ALL of:
 *   - activated === true
 *   - amoy_layer3_passes is an integer >= MIN_AMOY_LAYER3_PASSES
 *   - mainnet_smoke_tx is a non-empty string (the documented smoke tx hash)
 */
function validateRecord(record) {
  const reasons = [];
  if (!record) {
    return { valid: false, reasons: ["no_activation_record"] };
  }
  if (record.activated !== true) reasons.push("record_not_activated");

  const passes = record.amoy_layer3_passes;
  if (!Number.isInteger(passes) || passes < MIN_AMOY_LAYER3_PASSES) {
    reasons.push("amoy_layer3_below_threshold");
  }

  const tx = record.mainnet_smoke_tx;
  if (typeof tx !== "string" || tx.trim() === "") {
    reasons.push("missing_mainnet_smoke_tx");
  }

  return { valid: reasons.length === 0, reasons };
}

/**
 * Resolve whether a rail is ACTIVATION-PROVEN for this env.
 *
 * Returns:
 *   {
 *     proven: boolean,        // may the rail enter accepts[]? (env flag still also required upstream)
 *     source: "record" | "emergency_override" | "none",
 *     emergencyOverride: boolean,
 *     reasons: string[],      // why NOT proven (empty when proven via record)
 *     record: object | null,  // the record consulted (env wins over file)
 *     recordSource: "env" | "file" | "none",
 *   }
 *
 * Note: this does NOT read the enable flag or payTo — resolveActiveNetworks owns
 * those. This answers only "has the rail's settlement been PROVEN?".
 */
export function resolvePolygonActivation(env) {
  const gate = RAIL_GATES.polygon;

  // Emergency override short-circuits the record check — but loudly.
  const override = env?.[gate.override_env];
  if (override !== undefined && String(override).trim() === POLYGON_EMERGENCY_OVERRIDE_SENTINEL) {
    return {
      proven: true,
      source: "emergency_override",
      emergencyOverride: true,
      reasons: [],
      record: null,
      recordSource: "none",
    };
  }

  const fromEnv = recordFromEnv(env, gate.record_env);
  let record = null;
  let recordSource = "none";
  const reasons = [];

  if (fromEnv.parseError) {
    // A malformed env record is a hard invalid — never fall back to the file,
    // so a broken secret cannot mask itself behind the checked-in default.
    reasons.push(fromEnv.parseError);
    return {
      proven: false,
      source: "none",
      emergencyOverride: false,
      reasons,
      record: null,
      recordSource: "env",
    };
  }

  if (fromEnv.record) {
    record = fromEnv.record;
    recordSource = "env";
  } else {
    record = recordFromFile("polygon");
    recordSource = record ? "file" : "none";
  }

  const result = validateRecord(record);
  return {
    proven: result.valid,
    source: result.valid ? "record" : "none",
    emergencyOverride: false,
    reasons: result.reasons,
    record,
    recordSource,
  };
}

/**
 * Agent-facing lifecycle state for a rail, independent of accepts[] order.
 * Combines the enable flag (passed in) with the activation proof:
 *   - "active"   : flag on AND proven AND payTo present → in accepts[]
 *   - "unproven" : flag on but NO valid activation record → flag alone is ignored
 *   - "disabled" : flag off (default posture; the record may or may not be proven)
 *   - "override" : emergency override in force (proven without a valid record)
 */
export function polygonRailState({ enabled, hasPayTo, activation }) {
  if (activation.emergencyOverride) {
    return hasPayTo && enabled ? "override" : "override_pending";
  }
  if (!enabled) return "disabled";
  if (!activation.proven) return "unproven";
  if (!hasPayTo) return "enabled_no_payto";
  return "active";
}
