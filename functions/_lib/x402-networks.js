/**
 * x402 multi-network rail registry — single source of truth for the payment
 * rails Second Eyes can advertise in a v2 accepts[] array.
 *
 * Design rules (the whole point of this module):
 *  - Base (eip155:8453) is canonical and ALWAYS accepts[0]. Default posture is
 *    Base-only — nothing changes in production unless an operator opts in.
 *  - A rail is only appended to accepts[] when (a) its config exists AND (b) the
 *    server can actually verify+settle a payment for it. We never advertise a
 *    rail an agent could choose but the server cannot settle (a broken accepts[]
 *    entry is worse than no entry — the agent loses the spend).
 *  - Polygon (eip155:137) is EVM, same EIP-712 USDC path, same CDP facilitator,
 *    and can reuse the same merchant wallet — low risk, but NOT flag-only
 *    activatable: after the failed canary, the env flag X402_POLYGON_ENABLED is
 *    necessary but not sufficient. Polygon enters accepts[] only when the flag is
 *    set AND a valid activation record proves settlement (see x402-rail-activation.js),
 *    or an explicit emergency override is in force.
 *  - Solana (solana:…) uses base58 mints and non-EIP-712 signing. Our request
 *    shaping is EVM-shaped and has not been verified end-to-end against the CDP
 *    Solana facilitator, so it is "planned": surfaced in discovery, but NOT in
 *    accepts[] unless an operator double-gates it (payTo + explicit active flag).
 */

import {
  resolvePolygonActivation,
  polygonRailState,
} from "./x402-rail-activation.js";

/** USDC on Base mainnet (6 decimals) — canonical asset. */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913";

/** USDC on Polygon PoS mainnet (native Circle USDC, 6 decimals). */
export const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cc03d5c3359";

/** USDC SPL mint on Solana mainnet (Circle). */
export const USDC_SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** CAIP-2 id for Solana mainnet (genesis-hash reference per CAIP-2 / x402 docs). */
export const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/**
 * Rail descriptors. `status` reflects the DEFAULT posture, not the runtime one —
 * resolveActiveNetworks() decides what is actually accept-ready given env.
 */
export const BASE_NETWORK = {
  key: "base",
  id: "eip155:8453",
  namespace: "eip155",
  kind: "evm",
  asset: USDC_BASE,
  extra: { name: "USD Coin", version: "2" },
  canonical: true,
  status: "active",
  settled_by: "cdp",
};

export const POLYGON_NETWORK = {
  key: "polygon",
  id: "eip155:137",
  namespace: "eip155",
  kind: "evm",
  asset: USDC_POLYGON,
  extra: { name: "USD Coin", version: "2" },
  canonical: false,
  status: "activatable",
  settled_by: "cdp",
  // Same EVM EIP-712 verify/settle path as Base; the CDP facilitator settles
  // Polygon USDC and the same merchant wallet receives it.
  enable_env: "X402_POLYGON_ENABLED",
  payto_env: "X402_POLYGON_PAY_TO",
};

export const SOLANA_NETWORK = {
  key: "solana",
  id: SOLANA_MAINNET_CAIP2,
  namespace: "solana",
  kind: "svm",
  asset: USDC_SOLANA_MINT,
  // No EIP-712 domain on Solana — extra stays undefined for SVM accepts.
  canonical: false,
  status: "planned",
  settled_by: "cdp",
  // Double-gated: a payTo address AND an explicit active flag. Until both are set
  // (and an operator has confirmed CDP Solana settlement works on our request
  // shape) Solana is advertised as planned only and never enters accepts[].
  payto_env: "X402_SOLANA_PAY_TO",
  payto_env_alt: "SOLANA_PAY_TO",
  active_env: "X402_SOLANA_ACTIVE",
};

export const ALL_NETWORKS = [BASE_NETWORK, POLYGON_NETWORK, SOLANA_NETWORK];

function truthy(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/** EVM payTo for a network: explicit override, else the canonical Base payTo. */
function evmPayTo(network, env) {
  if (network.payto_env && env[network.payto_env]) return env[network.payto_env];
  return env.X402_PAYTO || null;
}

/** Solana payTo: dedicated env only — never guess, never reuse the EVM address. */
function solanaPayTo(env) {
  return env[SOLANA_NETWORK.payto_env] || env[SOLANA_NETWORK.payto_env_alt] || null;
}

/**
 * Resolve the rails that are accept-ready for THIS env, in advertise order.
 * Base is always first when X402_PAYTO is set. Returns [{ network, payTo }].
 */
export function resolveActiveNetworks(env) {
  const active = [];

  const basePayTo = env.X402_PAYTO;
  if (basePayTo) active.push({ network: BASE_NETWORK, payTo: basePayTo });

  // INVARIANT: Base (the canonical rail) must anchor accepts[0]. If no Base payTo
  // resolved, an optional rail with its OWN dedicated payTo (e.g. X402_POLYGON_PAY_TO
  // without X402_PAYTO) could otherwise produce a Base-less accepts[] led by
  // eip155:137 — which violates "Base is always accepts[0]" and would advertise a
  // non-canonical rail as the primary. No optional rail may be advertised without
  // Base present. There is no emergency override for this: Base is non-negotiable.
  if (!basePayTo) return active;

  // Polygon: opt-in flag + an EVM payTo + a VALID activation record (or emergency
  // override). The flag ALONE is intentionally not enough — that is the exact
  // failure mode (advertising eip155:137 before settlement was proven) this gate
  // exists to prevent.
  if (truthy(env[POLYGON_NETWORK.enable_env]) && resolvePolygonActivation(env).proven) {
    const payTo = evmPayTo(POLYGON_NETWORK, env);
    if (payTo) active.push({ network: POLYGON_NETWORK, payTo });
  }

  // Solana: double-gated. payTo present AND explicit active flag. Default off.
  if (truthy(env[SOLANA_NETWORK.active_env])) {
    const payTo = solanaPayTo(env);
    if (payTo) active.push({ network: SOLANA_NETWORK, payTo });
  }

  return active;
}

/**
 * Rails that are KNOWN but not accept-ready for this env — surfaced in discovery
 * as `planned_networks` so agents see the roadmap without being able to choose an
 * unsettleable rail. Includes the exact env vars required to activate each.
 */
export function plannedNetworks(env) {
  const activeIds = new Set(resolveActiveNetworks(env).map((a) => a.network.id));
  const planned = [];

  for (const network of [POLYGON_NETWORK, SOLANA_NETWORK]) {
    if (activeIds.has(network.id)) continue;
    planned.push(plannedDescriptor(network, env));
  }
  return planned;
}

/**
 * Lifecycle state per rail — independent of accepts[] order — for /api/bar and
 * /api/bar/proof. Base is always active/proven; Polygon reflects the activation
 * gate (disabled / unproven / active / override); Solana stays planned until its
 * double-gate + settlement confirmation. This is the operator/agent-readable map
 * that makes "flag is set but the rail is NOT advertised" visible instead of silent.
 */
export function railStates(env) {
  const e = env || {};
  const activeIds = new Set(resolveActiveNetworks(e).map((a) => a.network.id));
  const polyActivation = resolvePolygonActivation(e);
  const polyEnabled = truthy(e[POLYGON_NETWORK.enable_env]);
  // INVARIANT: an optional rail can never be "active" without the canonical Base
  // payTo, because resolveActiveNetworks refuses to advertise any optional rail when
  // X402_PAYTO is unset (Base must anchor accepts[0]). polygonRailState only sees the
  // flag/payTo/activation and would otherwise return "active" off X402_POLYGON_PAY_TO
  // alone — making proof/discovery report state=active/in_accepts=false (a rail that
  // says it is advertised while it is not). Gate the lifecycle on Base presence so the
  // state can NEVER claim active while not in accepts[].
  const baseMissing = !e.X402_PAYTO;
  const polyState = polygonRailState({
    enabled: polyEnabled,
    hasPayTo: Boolean(evmPayTo(POLYGON_NETWORK, e)),
    activation: polyActivation,
  });

  return [
    {
      key: "base",
      network: BASE_NETWORK.id,
      state: activeIds.has(BASE_NETWORK.id) ? "active" : "unconfigured",
      proven: true,
      in_accepts: activeIds.has(BASE_NETWORK.id),
      note: "Canonical rail. Always accepts[0] when X402_PAYTO is set.",
    },
    {
      key: "polygon",
      network: POLYGON_NETWORK.id,
      // Map internal gate states to a stable, agent-facing vocabulary. When the
      // canonical Base payTo is missing, the rail is BLOCKED regardless of its own
      // flag/record/payTo — it cannot enter accepts[] until Base anchors accepts[0].
      state: baseMissing
        ? "blocked"
        : polyState === "active"
          ? "active"
          : polyState === "override" || polyState === "override_pending"
            ? "emergency_override"
            : polyState === "unproven"
              ? "unproven"
              : "disabled",
      enabled: polyEnabled,
      proven: polyActivation.proven,
      emergency_override: polyActivation.emergencyOverride,
      in_accepts: activeIds.has(POLYGON_NETWORK.id),
      activation_source: polyActivation.recordSource,
      // Surface the missing-Base blocker FIRST so an operator sees the real reason the
      // rail is not advertised even when its own activation record is otherwise valid.
      blockers: baseMissing
        ? ["x402_base_payto_missing", ...polyActivation.reasons]
        : polyActivation.reasons,
      note: baseMissing
        ? "Blocked: canonical Base payTo X402_PAYTO is missing. Base must anchor accepts[0]; no optional rail is advertised until it is set — NOT in accepts[] regardless of the Polygon record."
        : polyState === "active"
          ? "Activation record valid — Polygon is in accepts[]."
          : polyState === "unproven"
            ? "X402_POLYGON_ENABLED is set but no valid activation record — NOT advertised. Flag alone is ignored."
            : polyActivation.emergencyOverride
              ? "Emergency override in force — Polygon advertised WITHOUT a proven record. Disable as soon as possible."
              : "Disabled (default posture after failed canary). Needs flag + valid activation record.",
    },
    {
      key: "solana",
      network: SOLANA_NETWORK.id,
      state: activeIds.has(SOLANA_NETWORK.id) ? "active" : "planned",
      proven: false,
      in_accepts: activeIds.has(SOLANA_NETWORK.id),
      note: "Double-gated SVM scaffold. Planned until payTo + active flag + confirmed CDP Solana settlement.",
    },
  ];
}

function plannedDescriptor(network, env) {
  if (network.key === "polygon") {
    const activation = resolvePolygonActivation(env || {});
    const enabled = truthy((env || {})[network.enable_env]);
    const state = polygonRailState({
      enabled,
      hasPayTo: Boolean(evmPayTo(network, env || {})),
      activation,
    });
    return {
      network: network.id,
      asset: "USDC",
      asset_address: network.asset,
      scheme: "ExactEvmScheme",
      // After the failed canary, the default posture is "disabled"; a flag set
      // without a proven record is "unproven" — never "activatable" by flag alone.
      status: state === "unproven" ? "unproven" : "disabled",
      activation_proven: activation.proven,
      activation_blockers: activation.reasons,
      requires:
        `${network.enable_env}=1 AND a valid activation record ` +
        `(config/x402-rail-activations.json or ${"X402_POLYGON_ACTIVATION_RECORD"}: ` +
        `activated=true, amoy_layer3_passes>=3, mainnet_smoke_tx set), ` +
        `or emergency override X402_POLYGON_EMERGENCY_OVERRIDE`,
      note:
        "Same EVM merchant wallet + CDP EIP-712 verify/settle path as Base, but NOT " +
        "flag-only activatable: the failed canary means settlement must be proven by " +
        "an activation record before eip155:137 enters accepts[]. See docs/x402-facilitator-testing.md.",
    };
  }
  return {
    network: network.id,
    asset: "USDC",
    asset_mint: network.asset,
    scheme: "ExactSvmScheme",
    status: "planned",
    requires: `${network.payto_env} (or ${network.payto_env_alt}) + ${network.active_env}=1`,
    note: "Solana SPL USDC. Scaffolded but not advertised in accepts[] until an operator supplies a Solana payTo AND confirms the CDP Solana facilitator settles on our request shape. Until then, pay on Base (or Polygon if enabled).",
  };
}

/**
 * Build a clean v2 accepts[] entry for a rail. EVM rails carry the EIP-712 domain
 * in `extra`; SVM rails omit it. Kept minimal — the CDP Bazaar indexer rejects
 * v1-style metadata (resource/description/mimeType) inside accepts[].
 */
export function buildAcceptEntry({ network, payTo }, amount) {
  const accept = {
    scheme: network.kind === "svm" ? "exact" : "exact",
    network: network.id,
    asset: network.asset,
    amount,
    payTo,
    maxTimeoutSeconds: 600,
  };
  if (network.extra) accept.extra = { ...network.extra };
  return accept;
}

/** CAIP-2 ids actually offered in accepts[] for this env (Base first). */
export function acceptedNetworkIds(env) {
  return resolveActiveNetworks(env).map((a) => a.network.id);
}

/**
 * Pure config sanity warnings — no D1, no network. Surfaced on the health/proof
 * surface so an operator who flips a rail flag but mis-wires the payTo sees the
 * silent misconfiguration instead of a Polygon rail that never enters accepts[]
 * (or, worse, one that enters but cannot settle). Returns [] when config is clean.
 */
export function x402ConfigWarnings(env) {
  if (!env) return [];
  const warnings = [];
  const activeIds = new Set(resolveActiveNetworks(env).map((a) => a.network.id));

  // INVARIANT GUARD: an optional rail is enabled but the canonical Base payTo
  // (X402_PAYTO) is missing. Without Base, accepts[] would either be empty (paid
  // routes return x402_not_configured) or — if the optional rail had its own payTo —
  // be led by a non-canonical rail, both of which violate "Base is always accepts[0]".
  // resolveActiveNetworks already refuses to advertise the optional rail in this
  // state; this surfaces WHY so an operator does not see a silently empty accepts[].
  const optionalRailEnabled =
    truthy(env[POLYGON_NETWORK.enable_env]) || truthy(env[SOLANA_NETWORK.active_env]);
  if (!env.X402_PAYTO && optionalRailEnabled) {
    const enabledRails = [];
    if (truthy(env[POLYGON_NETWORK.enable_env])) enabledRails.push(POLYGON_NETWORK.id);
    if (truthy(env[SOLANA_NETWORK.active_env])) enabledRails.push(SOLANA_NETWORK.id);
    warnings.push({
      code: "x402_base_payto_missing",
      network: BASE_NETWORK.id,
      enabled_rails: enabledRails,
      message:
        `An optional rail (${enabledRails.join(", ")}) is enabled but the canonical ` +
        `Base payTo X402_PAYTO is NOT set. Base (eip155:8453) must always be accepts[0]; ` +
        `an optional rail can never anchor or replace it. No optional rail is advertised ` +
        `until X402_PAYTO is set. Set X402_PAYTO (the canonical Base merchant wallet).`,
    });
  }

  // Polygon flag is on but the rail did not become accept-ready. After the failed
  // canary there are now two distinct reasons, and the operator needs to know WHICH:
  //   - no valid activation record (the flag-alone case the gate is built to catch), or
  //   - the record/override is fine but no EVM payTo resolved.
  if (truthy(env[POLYGON_NETWORK.enable_env]) && !activeIds.has(POLYGON_NETWORK.id)) {
    const activation = resolvePolygonActivation(env);
    if (!activation.proven) {
      warnings.push({
        code: "polygon_enabled_without_activation_record",
        network: POLYGON_NETWORK.id,
        blockers: activation.reasons,
        message:
          `${POLYGON_NETWORK.enable_env} is truthy but Polygon is NOT in accepts[] — ` +
          `no valid activation record (${activation.reasons.join(", ") || "none"}). The env ` +
          `flag ALONE does not advertise Polygon. Supply a record in ` +
          `config/x402-rail-activations.json or X402_POLYGON_ACTIVATION_RECORD ` +
          `(activated=true, amoy_layer3_passes>=3, mainnet_smoke_tx set) per ` +
          `docs/x402-facilitator-testing.md, or set the emergency override.`,
      });
    } else {
      warnings.push({
        code: "polygon_enabled_but_inactive",
        network: POLYGON_NETWORK.id,
        message:
          `${POLYGON_NETWORK.enable_env} is truthy and the activation record is valid, but ` +
          `Polygon is NOT in accepts[] — no payTo resolved. Set ${POLYGON_NETWORK.payto_env} ` +
          `or X402_PAYTO. A flag + record without a payTo silently advertises nothing.`,
      });
    }
  }

  // Emergency override is in force AND actually put Polygon in accepts[]: surface it
  // loudly so an unproven rail advertised by override is never silent.
  if (
    activeIds.has(POLYGON_NETWORK.id) &&
    resolvePolygonActivation(env).emergencyOverride
  ) {
    warnings.push({
      code: "polygon_emergency_override_active",
      network: POLYGON_NETWORK.id,
      message:
        `Polygon is in accepts[] via X402_POLYGON_EMERGENCY_OVERRIDE — settlement is ` +
        `NOT proven by an activation record. Treat as temporary; supply a real ` +
        `activation record and remove the override as soon as possible.`,
    });
  }

  // Solana active flag without a payTo: same silent-misconfig shape.
  if (truthy(env[SOLANA_NETWORK.active_env]) && !activeIds.has(SOLANA_NETWORK.id)) {
    warnings.push({
      code: "solana_active_but_inactive",
      network: SOLANA_NETWORK.id,
      message:
        `${SOLANA_NETWORK.active_env} is truthy but Solana is NOT in accepts[] — ` +
        `no Solana payTo resolved. Set ${SOLANA_NETWORK.payto_env} (or ${SOLANA_NETWORK.payto_env_alt}).`,
    });
  }

  return warnings;
}

/** The rail CAIP-2 a v2 buyer signed for, or null if the payload names none. */
export function payloadNetwork(paymentPayload) {
  return (
    paymentPayload?.accepted?.network ||
    paymentPayload?.network ||
    paymentPayload?.accepted?.[0]?.network ||
    null
  );
}

/**
 * Find the accept entry matching the rail a buyer actually signed for. v2 buyers
 * echo their chosen requirement under paymentPayload.accepted.network. Without this,
 * a multi-rail accepts[] would always verify against accepts[0] and reject any
 * non-Base payment.
 *
 * Resolution contract:
 *  - Buyer named a network present in accepts[] → that accept.
 *  - Buyer named a network NOT in accepts[]    → null (caller MUST reject; falling
 *    back to accepts[0] here would verify a Polygon/Solana signature against the
 *    Base requirement, which the facilitator rejects with no receipt — exactly the
 *    multi-rail failure mode we must never reintroduce).
 *  - Buyer named no network (single-rail / legacy signer) → accepts[0].
 */
export function selectAcceptForPayload(accepts, paymentPayload) {
  if (!Array.isArray(accepts) || accepts.length === 0) return null;
  const chosen = payloadNetwork(paymentPayload);
  if (chosen) {
    return accepts.find((a) => a.network === chosen) || null;
  }
  return accepts[0];
}
