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
 *    and can reuse the same merchant wallet — low risk, opt-in activatable.
 *  - Solana (solana:…) uses base58 mints and non-EIP-712 signing. Our request
 *    shaping is EVM-shaped and has not been verified end-to-end against the CDP
 *    Solana facilitator, so it is "planned": surfaced in discovery, but NOT in
 *    accepts[] unless an operator double-gates it (payTo + explicit active flag).
 */

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

  // Polygon: opt-in flag + an EVM payTo (reuses X402_PAYTO unless overridden).
  if (truthy(env[POLYGON_NETWORK.enable_env])) {
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
    planned.push(plannedDescriptor(network));
  }
  return planned;
}

function plannedDescriptor(network) {
  if (network.key === "polygon") {
    return {
      network: network.id,
      asset: "USDC",
      asset_address: network.asset,
      scheme: "ExactEvmScheme",
      status: "activatable",
      requires: `${network.enable_env}=1 (reuses X402_PAYTO, or set ${network.payto_env})`,
      note: "Same EVM merchant wallet + CDP EIP-712 verify/settle path as Base. Low-risk operator opt-in.",
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
 * Find the accept entry matching the rail a buyer actually signed for. v2 buyers
 * echo their chosen requirement under paymentPayload.accepted (or carry a top-level
 * network). Without this, a multi-rail accepts[] would always verify against
 * accepts[0] and reject any non-Base payment. Falls back to accepts[0] for
 * single-rail / legacy signers.
 */
export function selectAcceptForPayload(accepts, paymentPayload) {
  if (!Array.isArray(accepts) || accepts.length === 0) return null;
  const chosen =
    paymentPayload?.accepted?.network ||
    paymentPayload?.network ||
    paymentPayload?.accepted?.[0]?.network ||
    null;
  if (chosen) {
    const match = accepts.find((a) => a.network === chosen);
    if (match) return match;
  }
  return accepts[0];
}
