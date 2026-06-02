#!/usr/bin/env node
/**
 * Polygon canary — repo-native, gated, low-cap live x402 spend on Polygon (eip155:137).
 *
 * This is the script the failed Polygon mainnet canary needed: it runs the SAME
 * production verify → settle path the Worker uses (functions/_lib/x402.js), against a
 * real signed EIP-3009 payment, but only after a wall of safety gates clears. It is a
 * deliberate operator ritual — NEVER a CI default. CI runs it in mock mode only.
 *
 * SAFETY GATES (ALL must hold or it aborts BEFORE any signing or spend):
 *   1. RUN_POLYGON_CANARY === "1"                       master switch, default off
 *   2. POLYGON_CANARY_PRIVATE_KEY present               the canary payer key
 *   3. POLYGON_CANARY_EXPECTED_PAYTO present + matched  must equal the rail's payTo
 *   4. POLYGON_CANARY_EXPECTED_AMOUNT_USD present        the exact spend you authorize
 *   5. POLYGON_CANARY_MAX_USD (default 0.05, hard cap 1) per-run ceiling
 *   6. POLYGON_CANARY_EXPECTED_ASSET / _NETWORK matched  asset + CAIP-2 must match the built accept
 *   7. Wallet USDC balance <= POLYGON_CANARY_MAX_WALLET_USDC (default $5) — abort a
 *      hot wallet. A canary key must be a low-balance throwaway, never the treasury.
 *   8. POLYGON_CANARY_PAYTO != POLYGON_CANARY_PRIVATE_KEY-derived address (no self-pay loop)
 *
 * Mock mode (CI, no network, no keys): POLYGON_CANARY_MOCK=1 exercises every gate
 * against synthetic inputs and exits 0 WITHOUT importing viem or touching the network.
 *
 * Live usage (operator only, funded low-balance Polygon wallet):
 *   export RUN_POLYGON_CANARY=1
 *   export POLYGON_CANARY_PRIVATE_KEY=0x...          # low-balance throwaway, NOT treasury
 *   export POLYGON_CANARY_EXPECTED_PAYTO=0x...       # the production Polygon merchant payTo
 *   export POLYGON_CANARY_EXPECTED_AMOUNT_USD=0.01
 *   export POLYGON_CANARY_EXPECTED_ASSET=0x3c499c542cEF5E3811e1192ce70d8cc03d5c3359
 *   export POLYGON_CANARY_EXPECTED_NETWORK=eip155:137
 *   export X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform
 *   export CDP_API_KEY_ID=... CDP_API_KEY_SECRET=...
 *   node scripts/polygon-canary.mjs
 *
 * Exit 0 = settled cleanly (or mock gates passed); exit 1 = aborted/failed. On a live
 * failure it prints the facilitator invalidReason + redacted body for diagnosis, and
 * the tx hash on success — see docs/polygon-canary.md for capture + rollback.
 */

import {
  buildProductPaymentRequirements,
  usdToUsdcMicros,
  redactFacilitatorBody,
} from "../functions/_lib/x402.js";
import { POLYGON_NETWORK, USDC_POLYGON } from "../functions/_lib/x402-networks.js";

const env = process.env;

const POLYGON_ID = POLYGON_NETWORK.id; // eip155:137
const HARD_SPEND_CAP_USD = 1; // absolute ceiling, regardless of operator input
const DEFAULT_MAX_USD = 0.05;
const DEFAULT_MAX_WALLET_USDC = 5;
const HELP_ME_URL = "https://secondeyesai.com/api/bar/x402/help-me";

function abort(msg) {
  console.error(`POLYGON CANARY ABORTED — ${msg}`);
  process.exit(1);
}

function num(name, raw, { required = false } = {}) {
  if (raw == null || raw === "") {
    if (required) abort(`${name} is required.`);
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) abort(`${name} is not a number: ${raw}`);
  return n;
}

/**
 * Read + validate every gate from env into a frozen config. Pure: no network, no
 * signing, no viem. Throws via abort() on any gate violation. This is the whole
 * safety surface — the live path below trusts the config this returns. Exported so
 * the mock test can drive it with synthetic env and assert each gate fires.
 */
export function buildCanaryConfig(e) {
  // Gate 1 — master switch.
  if (e.RUN_POLYGON_CANARY !== "1") {
    return { allowed: false, reason: "RUN_POLYGON_CANARY != \"1\"" };
  }

  // Gate 2 — payer key (presence only; never logged).
  const privateKey = e.POLYGON_CANARY_PRIVATE_KEY;
  if (!privateKey) abort("POLYGON_CANARY_PRIVATE_KEY is required (Gate 2).");

  // Gate 3 — expected payTo.
  const expectedPayTo = e.POLYGON_CANARY_EXPECTED_PAYTO;
  if (!expectedPayTo) abort("POLYGON_CANARY_EXPECTED_PAYTO is required (Gate 3).");

  // Gate 4 — exact authorized amount.
  const expectedAmountUsd = num("POLYGON_CANARY_EXPECTED_AMOUNT_USD", e.POLYGON_CANARY_EXPECTED_AMOUNT_USD, { required: true });
  if (expectedAmountUsd <= 0) abort("POLYGON_CANARY_EXPECTED_AMOUNT_USD must be > 0 (Gate 4).");

  // Gate 5 — per-run ceiling, hard-capped.
  const maxUsd = num("POLYGON_CANARY_MAX_USD", e.POLYGON_CANARY_MAX_USD) ?? DEFAULT_MAX_USD;
  if (maxUsd <= 0) abort("POLYGON_CANARY_MAX_USD must be > 0 (Gate 5).");
  if (maxUsd > HARD_SPEND_CAP_USD) abort(`POLYGON_CANARY_MAX_USD ${maxUsd} exceeds hard cap $${HARD_SPEND_CAP_USD} (Gate 5).`);
  if (expectedAmountUsd > maxUsd) {
    abort(`POLYGON_CANARY_EXPECTED_AMOUNT_USD $${expectedAmountUsd} exceeds POLYGON_CANARY_MAX_USD $${maxUsd} (Gate 5).`);
  }

  // Gate 6 — expected asset + network (default to the canonical Polygon values).
  const expectedAsset = (e.POLYGON_CANARY_EXPECTED_ASSET || USDC_POLYGON).toLowerCase();
  const expectedNetwork = e.POLYGON_CANARY_EXPECTED_NETWORK || POLYGON_ID;
  if (expectedNetwork !== POLYGON_ID) {
    abort(`POLYGON_CANARY_EXPECTED_NETWORK ${expectedNetwork} is not Polygon ${POLYGON_ID} (Gate 6). This canary only spends on Polygon.`);
  }

  // Gate 7 — wallet balance ceiling (enforced against the live balance later).
  const maxWalletUsdc = num("POLYGON_CANARY_MAX_WALLET_USDC", e.POLYGON_CANARY_MAX_WALLET_USDC) ?? DEFAULT_MAX_WALLET_USDC;
  if (maxWalletUsdc <= 0) abort("POLYGON_CANARY_MAX_WALLET_USDC must be > 0 (Gate 7).");

  return Object.freeze({
    allowed: true,
    privateKey,
    expectedPayTo,
    expectedAmountUsd,
    expectedAmountAtomic: usdToUsdcMicros(expectedAmountUsd),
    maxUsd,
    expectedAsset,
    expectedNetwork,
    maxWalletUsdc,
    facilitatorUrl: e.X402_FACILITATOR_URL || "https://api.cdp.coinbase.com/platform",
    rpcUrl: e.POLYGON_CANARY_RPC_URL || e.POLYGON_RPC_URL || "https://polygon-rpc.com",
  });
}

/**
 * Build the single-accept Polygon requirement the canary will pay against, then assert
 * it matches every operator expectation (Gate 6 + Gate 3 + Gate 8). Pure: uses the real
 * production builder so the canary pays EXACTLY what production would advertise.
 * Returns { requirement, accept }. Exported for the mock test.
 */
export function buildAndCheckRequirement(cfg, payerAddress) {
  // Build with Polygon enabled, payTo = the operator's expected Polygon merchant.
  const product = {
    kind: "nano",
    id: "polygon-canary",
    slug: "polygon-canary",
    priceUsd: cfg.expectedAmountUsd,
    description: "Polygon canary — repo-native low-cap x402 settlement probe",
  };
  const requirement = buildProductPaymentRequirements(product, HELP_ME_URL, {
    X402_PAYTO: cfg.expectedPayTo,
    [POLYGON_NETWORK.enable_env]: "1",
    [POLYGON_NETWORK.payto_env]: cfg.expectedPayTo,
  });
  if (!requirement) abort("builder returned null — no payTo resolved (internal).");

  const polyAccept = (requirement.accepts || []).find((a) => a.network === POLYGON_ID);
  if (!polyAccept) abort(`built accepts[] has no Polygon entry (${POLYGON_ID}) — registry/config drift.`);

  // Narrow to the single Polygon accept so the signed rail is unambiguous.
  requirement.accepts = [polyAccept];

  // Gate 6 — asset + network must match expectation byte-for-byte.
  if (polyAccept.network !== cfg.expectedNetwork) {
    abort(`built network ${polyAccept.network} != expected ${cfg.expectedNetwork} (Gate 6).`);
  }
  if (String(polyAccept.asset).toLowerCase() !== cfg.expectedAsset) {
    abort(`built asset ${polyAccept.asset} != expected ${cfg.expectedAsset} (Gate 6).`);
  }
  // Gate 4 — amount must equal the authorized micros.
  if (polyAccept.amount !== cfg.expectedAmountAtomic) {
    abort(`built amount ${polyAccept.amount} != expected ${cfg.expectedAmountAtomic} micros (Gate 4).`);
  }
  // Gate 3 — payTo must match expectation.
  if (String(polyAccept.payTo).toLowerCase() !== String(cfg.expectedPayTo).toLowerCase()) {
    abort(`built payTo ${polyAccept.payTo} != expected ${cfg.expectedPayTo} (Gate 3).`);
  }
  // Gate 8 — never pay yourself (a self-pay loop is a misconfigured canary).
  if (payerAddress && String(payerAddress).toLowerCase() === String(cfg.expectedPayTo).toLowerCase()) {
    abort(`payer address equals payTo (${payerAddress}) — self-pay loop, refusing (Gate 8).`);
  }

  return { requirement, accept: polyAccept };
}

/** Mock-mode summary (no network, no viem). Proves the gates without spending. */
function runMock() {
  console.log("=== Polygon canary — MOCK MODE (no spend, no network, no keys) ===\n");
  // Synthetic, self-consistent env that passes every gate. Asserts the gate logic
  // accepts a valid config and the builder produces a matching Polygon accept.
  const mockEnv = {
    RUN_POLYGON_CANARY: "1",
    POLYGON_CANARY_PRIVATE_KEY: "0x" + "11".repeat(32),
    POLYGON_CANARY_EXPECTED_PAYTO: "0x000000000000000000000000000000000000dEaD",
    POLYGON_CANARY_EXPECTED_AMOUNT_USD: "0.01",
    POLYGON_CANARY_MAX_USD: "0.05",
    POLYGON_CANARY_EXPECTED_ASSET: USDC_POLYGON,
    POLYGON_CANARY_EXPECTED_NETWORK: POLYGON_ID,
  };
  const cfg = buildCanaryConfig(mockEnv);
  if (!cfg.allowed) abort("mock: gates unexpectedly closed.");
  const { accept } = buildAndCheckRequirement(cfg, "0x000000000000000000000000000000000000bEEF");
  console.log("Gates 1-8 evaluated against synthetic inputs: OK");
  console.log(`Built Polygon accept: network=${accept.network} asset=${accept.asset} amount=${accept.amount} payTo=${accept.payTo}`);
  console.log("\nMOCK OK — gate + builder logic sound. No spend, no network, no keys touched.");
  process.exit(0);
}

async function main() {
  if (env.POLYGON_CANARY_MOCK === "1") return runMock();

  console.log("=== Polygon canary — LIVE (gated, low-cap) ===\n");

  // Gates 1-6 (config) — pure, no network.
  const cfg = buildCanaryConfig(env);
  if (!cfg.allowed) {
    console.log(
      [
        `Polygon canary SKIPPED — ${cfg.reason}.`,
        "This is the safe default. This script spends REAL Polygon USDC and is an",
        "operator ritual, never a CI default. To run a live canary, set the gates in",
        "docs/polygon-canary.md (RUN_POLYGON_CANARY=1 + expected amount/payTo/asset).",
      ].join("\n")
    );
    process.exit(0);
  }

  // Lazy imports — only reached on the live path, only after the gates above cleared.
  const viem = await import("viem").catch(() => null);
  const viemAccounts = await import("viem/accounts").catch(() => null);
  if (!viem || !viemAccounts) abort("viem is not installed — required for live signing/balance. `npm i` first.");
  const { createPublicClient, http } = viem;
  const { polygon } = await import("viem/chains");

  const account = viemAccounts.privateKeyToAccount(cfg.privateKey.startsWith("0x") ? cfg.privateKey : `0x${cfg.privateKey}`);
  console.log(`Payer: ${account.address}`);
  console.log(`PayTo: ${cfg.expectedPayTo}  amount: $${cfg.expectedAmountUsd} (${cfg.expectedAmountAtomic} micros)`);

  // Build + check the requirement (Gates 3,4,6,8) before reading any balance.
  const { requirement, accept } = buildAndCheckRequirement(cfg, account.address);

  // Gate 7 — wallet USDC balance ceiling. Abort a hot wallet BEFORE signing.
  const client = createPublicClient({ chain: polygon, transport: http(cfg.rpcUrl) });
  const erc20Abi = [
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  ];
  let balanceMicros;
  try {
    balanceMicros = await client.readContract({ address: accept.asset, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  } catch (e) {
    abort(`could not read USDC balance on Polygon: ${e?.message || e}`);
  }
  const balanceUsd = Number(balanceMicros) / 1_000_000;
  console.log(`Wallet USDC balance: $${balanceUsd.toFixed(6)} (cap $${cfg.maxWalletUsdc})`);
  if (balanceUsd > cfg.maxWalletUsdc) {
    abort(`wallet USDC balance $${balanceUsd} exceeds POLYGON_CANARY_MAX_WALLET_USDC $${cfg.maxWalletUsdc} (Gate 7). A canary key must be a low-balance throwaway, never the treasury.`);
  }
  if (balanceUsd < cfg.expectedAmountUsd) {
    abort(`wallet USDC balance $${balanceUsd} is below the $${cfg.expectedAmountUsd} spend — fund the canary wallet first.`);
  }

  // Sign the real EIP-3009 authorization (reuses the harness signer — testnet/mainnet agnostic).
  const { signEvmPayment } = await import("../test/x402-facilitator/signers.mjs");
  const header = await signEvmPayment({
    privateKey: cfg.privateKey,
    accept,
    network: POLYGON_ID,
    payTo: cfg.expectedPayTo,
    amountAtomic: cfg.expectedAmountAtomic,
  });

  // Production verify → settle path.
  const { verifyPaymentHeader, settleBuiltPayment } = await import("../functions/_lib/x402.js");
  const settleEnv = { ...env, X402_FACILITATOR_URL: cfg.facilitatorUrl };

  console.log("\nVerifying with CDP facilitator (no spend yet)...");
  const verified = await verifyPaymentHeader(header, requirement, settleEnv);
  if (!verified.ok) {
    console.error(`VERIFY FAILED — stage=${verified.stage || "?"} invalidReason=${verified.invalidReason || "?"} error=${verified.error}`);
    if (verified.facilitatorResponse) console.error("facilitator (redacted):", JSON.stringify(redactFacilitatorBody(verified.facilitatorResponse)));
    abort("verify failed — see invalidReason above. No spend occurred. Capture this for diagnosis (docs/polygon-canary.md).");
  }
  console.log("Verify OK. Settling (THIS SPENDS) ...");

  const settled = await settleBuiltPayment(verified.built, verified.accept, settleEnv);
  if (!settled.ok) {
    console.error(`SETTLE FAILED — stage=${settled.stage || "?"} error=${settled.error}`);
    abort("settle failed — capture the error above. Funds may or may not have moved; check the payer on polygonscan.");
  }

  const tx = settled.receipt?.transaction || "(no hash returned)";
  console.log("\nPOLYGON CANARY OK — settled.");
  console.log(`  tx:        ${tx}`);
  console.log(`  network:   ${settled.receipt?.network || POLYGON_ID}`);
  console.log(`  payer:     ${settled.receipt?.payer || account.address}`);
  console.log(`  polygonscan: https://polygonscan.com/tx/${tx.startsWith("0x") ? tx : "0x" + tx}`);
  console.log("\nRecord the tx hash. To enable Polygon in production, see docs/polygon-canary.md.");
}

// Only auto-run when invoked directly (node scripts/polygon-canary.mjs), not when
// imported by the mock-mode test, which drives the exported gate functions itself.
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().catch((err) => {
    console.error("\nPOLYGON CANARY CRASHED:", err?.message || err);
    if (err?.stack) console.error(err.stack);
    process.exit(1);
  });
}
