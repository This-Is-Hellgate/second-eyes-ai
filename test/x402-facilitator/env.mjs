// test/x402-facilitator/env.mjs
// Centralized env reading + safety gates for the CDP x402 facilitator integration
// test harness. Every layer (mocked / dry-run / settlement) pulls config through
// this module so the safety rules live in exactly ONE place.
//
// This adapts the uploaded three-layer spec to the real repo: plain Node ESM,
// no Vitest, asserting against functions/_lib/x402.js + x402-networks.js. The
// production env var names are the repo's actual ones (X402_PAYTO,
// X402_POLYGON_PAY_TO, X402_SOLANA_PAY_TO) — NOT the spec's idealized aliases —
// because the test harness must match what an operator actually sets.

import { facilitatorPaths } from "../../functions/_lib/cdp-auth.js";

// ---------------------------------------------------------------------------
// Gates — the only thing standing between this harness and real spend.
// ---------------------------------------------------------------------------

/** True when Layer 3 (real signing + real on-chain tx) is permitted. */
export function settlementAllowed(env) {
  return env.RUN_X402_SETTLEMENT_TESTS === "1";
}

/**
 * True only when mainnet settlement is explicitly, awkwardly opted into.
 * Testnet-only is the safe default. The phrase is deliberately clumsy so it is
 * never flipped by a stray "1".
 */
export function mainnetSettlementAllowed(env) {
  return env.ALLOW_MAINNET_SETTLEMENT === "I_UNDERSTAND";
}

/**
 * Per-run total spend cap in USD. Defaults to $0.25. Hard ceiling is $5 — the
 * harness refuses to run Layer 3 above it, regardless of operator input.
 */
export function spendCapUsd(env) {
  const raw = env.MAX_TEST_SPEND_USD;
  if (!raw) return 0.25;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`MAX_TEST_SPEND_USD invalid: ${raw}`);
  }
  if (n > 5) throw new Error(`MAX_TEST_SPEND_USD too high: ${raw} (hard cap is $5)`);
  return n;
}

/**
 * Convert USD to USDC atomic units (6 decimals / micros) as a string. This is
 * the SAME convention as functions/_lib/x402.js usdToUsdcMicros — re-derived
 * here so the harness can assert the production builder against an independent
 * implementation. usdToAtomic(0.001) === "1000".
 */
export function usdToAtomic(usd) {
  const micros = Math.round(usd * 1_000_000);
  if (micros <= 0) throw new Error(`usdToAtomic: non-positive: ${usd}`);
  return String(micros);
}

// ---------------------------------------------------------------------------
// Test network table — testnets only. These CAIP-2 ids are deliberately NOT the
// production mainnet ids the rail registry advertises, so a test fixture can
// never be confused for a production accept[].
// ---------------------------------------------------------------------------

export const TESTNETS = {
  "base-sepolia": {
    network: "eip155:84532",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    isMainnet: false,
    defaultFacilitatorUrl: "https://api.cdp.coinbase.com/platform/v2/x402",
    faucetUrl: "https://faucet.circle.com/",
    nativeGasNote:
      "~0.001 Base Sepolia ETH for gas (the facilitator sponsors EIP-3009 transfers).",
  },
  "polygon-amoy": {
    network: "eip155:80002",
    asset: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    isMainnet: false,
    // CDP's hosted facilitator does NOT cover Amoy — use Polygon's or x402.rs.
    defaultFacilitatorUrl: "https://x402-amoy.polygon.technology",
    faucetUrl: "https://faucet.circle.com/",
    nativeGasNote: "~0.01 Amoy POL for gas; CDP facilitator does NOT cover Amoy.",
  },
  "solana-devnet": {
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    isMainnet: false,
    defaultFacilitatorUrl: "https://api.cdp.coinbase.com/platform/v2/x402",
    faucetUrl: "https://faucet.circle.com/",
    nativeGasNote: "~0.01 devnet SOL for ATA init; SPL transfer fee paid by feePayer.",
  },
};

/** Resolve the facilitator URL for a test network, applying the per-net override. */
export function facilitatorUrlFor(env, net) {
  const overrideKey = {
    "base-sepolia": "TEST_FACILITATOR_URL_BASE_SEPOLIA",
    "polygon-amoy": "TEST_FACILITATOR_URL_POLYGON_AMOY",
    "solana-devnet": "TEST_FACILITATOR_URL_SOLANA_DEVNET",
  }[net];
  return env[overrideKey] || TESTNETS[net].defaultFacilitatorUrl;
}

/**
 * Build the GET /supported reachability URL for a configured facilitator base,
 * tolerant of however much of the CDP path the operator baked in.
 *
 * The CDP /supported endpoint lives at `<origin>/platform/v2/x402/supported`, so
 * a base of `<origin>/platform` (the canonical docs/.env form) MUST still resolve
 * to the full `/platform/v2/x402/supported` route — naively appending `/supported`
 * would 404 on `<origin>/platform/supported`. We reuse the production
 * facilitatorPaths() normalization for any CDP `/platform...` base (it strips a
 * trailing /platform, /platform/v2, or /platform/v2/x402 and re-derives the
 * canonical route), then swap the verify leaf for /supported.
 *
 * Non-CDP facilitators (e.g. Polygon Amoy at x402-amoy.polygon.technology) expose
 * /supported directly off their origin and carry no /platform prefix, so we append
 * /supported to the trimmed base unchanged.
 */
export function supportedUrlFor(baseUrl) {
  const trimmed = String(baseUrl || "").replace(/\/+$/, "");
  if (/\/platform(\/|$)/.test(trimmed)) {
    const { base } = facilitatorPaths(trimmed);
    return `${base}/platform/v2/x402/supported`;
  }
  return `${trimmed}/supported`;
}

/** A facilitator URL is mainnet-ish if it lacks any testnet marker. */
export function looksLikeMainnetUrl(url) {
  const u = String(url || "").toLowerCase();
  const testnetMarkers = ["sepolia", "amoy", "devnet", "testnet", "localhost", "127.0.0.1"];
  return !testnetMarkers.some((m) => u.includes(m));
}

// ---------------------------------------------------------------------------
// Wallet isolation — the harness refuses to run if a test payTo equals the
// production payTo. A leaked test key must never be able to move, or be
// confused with, production funds. This is the spec's assertTestPayToIsolation,
// keyed to the repo's real production var names.
// ---------------------------------------------------------------------------

export function assertTestPayToIsolation(env) {
  // EVM: production Base recipient is X402_PAYTO; optional Polygon override.
  const prodEvm = [env.X402_PAYTO, env.X402_POLYGON_PAY_TO].filter(Boolean).map((a) => a.toLowerCase());
  if (env.TEST_EVM_PAY_TO && prodEvm.includes(env.TEST_EVM_PAY_TO.toLowerCase())) {
    throw new Error(
      "TEST_EVM_PAY_TO equals a production EVM payTo (X402_PAYTO / X402_POLYGON_PAY_TO). " +
        "Use a separate test treasury — never reuse the production receive wallet."
    );
  }
  // Solana: production recipient is X402_SOLANA_PAY_TO (or SOLANA_PAY_TO).
  const prodSol = [env.X402_SOLANA_PAY_TO, env.SOLANA_PAY_TO].filter(Boolean);
  if (env.TEST_SOLANA_PAY_TO && prodSol.includes(env.TEST_SOLANA_PAY_TO)) {
    throw new Error(
      "TEST_SOLANA_PAY_TO equals a production Solana payTo (X402_SOLANA_PAY_TO / SOLANA_PAY_TO). " +
        "Use a separate test treasury."
    );
  }
}

/**
 * The test signing key must never be the production CDP/canary wallet. We can't
 * see the production key here, but we CAN refuse the most dangerous footgun: a
 * test key whose env value also appears under a production-looking var.
 */
export function assertTestKeyIsolation(env) {
  const prodKeyVars = ["X402_PAYTO_PRIVATE_KEY", "CANARY_WALLET_KEY", "CDP_API_KEY_SECRET"];
  for (const v of prodKeyVars) {
    if (env.TEST_EVM_PRIVATE_KEY && env[v] && env.TEST_EVM_PRIVATE_KEY === env[v]) {
      throw new Error(`TEST_EVM_PRIVATE_KEY must not equal production ${v}.`);
    }
  }
}
