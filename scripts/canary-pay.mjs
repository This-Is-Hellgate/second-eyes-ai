#!/usr/bin/env node
/**
 * Canary x402 payment (v2) against the production Second Eyes x402 bar.
 *
 * Targets the NO-SESSION bar taps (discover -> pay -> use in one shot) so the
 * settlement cleanly triggers CDP Bazaar cataloging. Settling on an endpoint is
 * what makes it index (cataloging is settle-driven, per bazaar.md client echo).
 *
 * Requires: CANARY_WALLET_KEY (0x-prefixed private key) funded with Base USDC.
 *   - Reads CANARY_WALLET_KEY from env, or from cdp-credentials.local.json.
 *   - Gas is sponsored by Coinbase on Base mainnet; you only need USDC.
 *
 * @see @x402/fetch — wrapFetchWithPayment(fetch, x402Client) (x402 v2)
 */
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://secondeyesai.com";
const PAYTO = "0xFb8915074cC941f5Ab95E6001c45287b8EeC4427";
const NETWORK = "eip155:8453";
const CDP_MERCHANT = `https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant?payTo=${PAYTO}`;

// No-session bar taps. Settling each one indexes that resource on the Bazaar.
// Cheapest first; new revenue doors before the $0.25 doctor. Launch recovery pricing.
const TARGETS = [
  { name: "aws-agent-survival", price: "$0.01", url: `${BASE}/api/bar/x402/aws-agent-survival` },
  { name: "help-me", price: "$0.01", url: `${BASE}/api/bar/x402/help-me?state=I+am+looping` },
  { name: "peril-router (legacy alias)", price: "$0.01", url: `${BASE}/api/bar/x402/peril-router?state=I+am+looping` },
  { name: "payment-confirmation-check", price: "$0.01", url: `${BASE}/api/bar/x402/payment-confirmation-check?tx=0xabc123&status=pending` },
  { name: "schema-repair", price: "$0.03", url: `${BASE}/api/bar/x402/schema-repair?error=expected+string+got+number` },
  { name: "context-pressure", price: "$0.03", url: `${BASE}/api/bar/x402/context-pressure?remaining_context=8%25` },
  { name: "loop-detect", price: "$0.03", url: `${BASE}/api/bar/x402/loop-detect` },
  { name: "bazaar-index-check", price: "$0.05", url: `${BASE}/api/bar/x402/index-check?payTo=${PAYTO}` },
  { name: "x402-doctor", price: "$0.25", url: `${BASE}/api/bar/x402/doctor?url=https://api.oatp.cc/tools/tx_explainer` },
];

// Optional: settle multimodal doors when a public test asset URL is provided.
if (process.env.CANARY_TRANSCRIBE_URL) {
  TARGETS.splice(2, 0, {
    name: "transcribe-extract",
    price: "$0.05",
    url: `${BASE}/api/bar/x402/transcribe?url=${encodeURIComponent(process.env.CANARY_TRANSCRIBE_URL)}&kind=pdf`,
  });
}
if (process.env.CANARY_EXTRACT_URL) {
  TARGETS.splice(process.env.CANARY_TRANSCRIBE_URL ? 3 : 2, 0, {
    name: "doc-extract",
    price: "$0.05",
    url: `${BASE}/api/bar/x402/extract?url=${encodeURIComponent(process.env.CANARY_EXTRACT_URL)}&doc_type=generic`,
  });
}

function log(step, msg, extra) {
  console.log(`\n=== ${step} ===`);
  console.log(msg);
  if (extra !== undefined) console.log(typeof extra === "string" ? extra : JSON.stringify(extra, null, 2));
}

function normalizeKey(raw) {
  if (!raw) return null;
  const k = String(raw).trim();
  return k.startsWith("0x") ? k : `0x${k}`;
}

function loadKey() {
  if (process.env.CANARY_WALLET_KEY) return normalizeKey(process.env.CANARY_WALLET_KEY);
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const p = join(root, "cdp-credentials.local.json");
  if (existsSync(p)) {
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      if (j.CANARY_WALLET_KEY) return normalizeKey(j.CANARY_WALLET_KEY);
    } catch {
      /* ignore */
    }
  }
  return null;
}

function basescanTx(tx) {
  const hash = tx?.startsWith("0x") ? tx : `0x${tx}`;
  return `https://basescan.org/tx/${hash}`;
}

function buildPayingFetch(key) {
  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: base, transport: http() });
  const signer = toClientEvmSigner(account, publicClient);
  const client = new x402Client().register(NETWORK, new ExactEvmScheme(signer));
  return { account, fetchWithPay: wrapFetchWithPayment(fetch, client) };
}

async function probe402(target) {
  const res = await fetch(target.url, { headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  log(`probe ${target.name} (unpaid)`, `HTTP ${res.status}`, {
    x402Version: body.x402Version,
    resource: body.resource,
    network: body.accepts?.[0]?.network,
    amount: body.accepts?.[0]?.amount,
  });
  if (res.status !== 402) throw new Error(`${target.name}: expected 402, got ${res.status}`);
  if (!Array.isArray(body.accepts) || body.accepts.length === 0) {
    throw new Error(`${target.name}: 402 body missing accepts[]`);
  }
  return body;
}

async function pay(target, fetchWithPay) {
  const res = await fetchWithPay(target.url, { headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  const header = res.headers.get("X-PAYMENT-RESPONSE") || res.headers.get("PAYMENT-RESPONSE");
  let decoded;
  if (header) {
    try {
      decoded = decodePaymentResponseHeader(header);
    } catch (e) {
      decoded = { decode_error: String(e), raw: header };
    }
  }
  const tx = body.receipt?.transaction || decoded?.transaction || decoded?.txHash || decoded?.tx;
  log(`pay ${target.name} (${target.price})`, `HTTP ${res.status}`, {
    access: body.access,
    grantId: body.grantId,
    tx,
    payment_response: decoded,
  });
  if (res.status !== 200) throw new Error(`${target.name}: paid request failed (${res.status}) ${body.error || ""}`);
  if (!tx) throw new Error(`${target.name}: no transaction hash in receipt or X-PAYMENT-RESPONSE`);
  return { tx, body };
}

async function checkIndex() {
  const res = await fetch(CDP_MERCHANT, { headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  const count = Array.isArray(body.resources) ? body.resources.length : "?";
  log("CDP index (merchant by payTo)", `HTTP ${res.status} — resources indexed for our wallet: ${count}`, {
    resources: (body.resources || []).map((r) => r.resource),
  });
  return count;
}

async function main() {
  const key = loadKey();

  if (process.argv.includes("--address-only")) {
    if (!key) {
      console.error("No CANARY_WALLET_KEY (env or cdp-credentials.local.json).");
      process.exit(1);
    }
    console.log("Canary payer address (fund with Base USDC):", privateKeyToAccount(key).address);
    process.exit(0);
  }

  // Always show current index state first (baseline).
  await checkIndex();

  if (!key) {
    log("wallet", "No CANARY_WALLET_KEY found — running unpaid 402 probes only.");
    for (const t of TARGETS) await probe402(t);
    console.log("\nSet CANARY_WALLET_KEY (or cdp-credentials.local.json) + fund the address, then re-run.");
    process.exit(0);
  }

  const { account, fetchWithPay } = buildPayingFetch(key);
  log("wallet", `Payer ${account.address} — paying ${TARGETS.map((t) => `${t.name} ${t.price}`).join(", ")}`);

  const results = [];
  for (const t of TARGETS) {
    await probe402(t);
    const { tx } = await pay(t, fetchWithPay);
    results.push({ name: t.name, tx, basescan: basescanTx(tx) });
  }

  await checkIndex();

  log("result", "Settlements submitted. CDP cataloging is settle-driven and refreshes on a ~6h schedule.", results);
  console.log("\nRe-check indexing later:");
  console.log("   ", CDP_MERCHANT);
  console.log("    node scripts/canary-pay.mjs   (re-runs index check + pays again)");
}

main().catch((err) => {
  console.error("\nCANARY FAILED:", err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
