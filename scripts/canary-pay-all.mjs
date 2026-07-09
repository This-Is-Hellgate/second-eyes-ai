#!/usr/bin/env node
/**
 * canary-pay-all — settle one x402 payment on every door that is NOT yet
 * indexed on the CDP Bazaar, so it indexes (cataloging is settle-driven).
 *
 * Discovery-driven: the door list comes from the live
 * /v2/x402/discovery/resources document and the already-indexed set from the
 * CDP merchant record — nothing hardcoded, cannot drift from the menu.
 * Doors requiring caller inputs to produce a meaningful answer are still
 * safely payable bare: every unlisted door treats inputs as optional.
 *
 * Usage:
 *   node scripts/canary-pay-all.mjs --dry-run   # show what would be paid
 *   node scripts/canary-pay-all.mjs             # pay unlisted doors only
 *   node scripts/canary-pay-all.mjs --all       # pay every door (refresh)
 *
 * Requires: CANARY_WALLET_KEY (env) or cdp-credentials.local.json at repo
 * root with { "CANARY_WALLET_KEY": "0x…" }, funded with USDC on Base.
 * Gas is sponsored by Coinbase on Base mainnet; you only need USDC.
 */
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
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
const DISCOVERY = `${BASE}/v2/x402/discovery/resources`;
const CDP_MERCHANT = `https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant?payTo=${PAYTO}`;

function normalizeKey(k) {
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

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

function priceUsd(item) {
  return Number(item?.price_usd || 0);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const payAll = process.argv.includes("--all");

  const doc = await getJson(DISCOVERY);
  const doors = (doc.resources || []).map((r) => ({
    url: r.resource,
    slug: r.resource.split("/").pop(),
    usd: priceUsd(r),
  }));

  const merchant = await getJson(CDP_MERCHANT);
  const indexed = new Set((merchant.resources || []).map((r) => String(r.resource).toLowerCase()));

  const targets = payAll ? doors : doors.filter((d) => !indexed.has(d.url.toLowerCase()));
  const total = targets.reduce((s, d) => s + d.usd, 0);

  console.log(`doors in discovery: ${doors.length} | already on Bazaar: ${indexed.size} | to pay: ${targets.length} | total: $${total.toFixed(2)} USDC`);
  for (const t of targets) console.log(`  $${t.usd.toFixed(2)}  ${t.slug}`);
  if (dryRun) return;
  if (targets.length === 0) {
    console.log("Nothing to pay — every discovered door is already indexed.");
    return;
  }

  const key = loadKey();
  if (!key) {
    console.error("No CANARY_WALLET_KEY (env or cdp-credentials.local.json).");
    process.exit(1);
  }
  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: base, transport: http() });
  const signer = toClientEvmSigner(account, publicClient);
  const client = new x402Client().register(NETWORK, new ExactEvmScheme(signer));
  const payingFetch = wrapFetchWithPayment(fetch, client);
  console.log(`paying from ${account.address}`);

  let paid = 0;
  let failed = 0;
  for (const t of targets) {
    try {
      const res = await payingFetch(t.url, { headers: { Accept: "application/json" } });
      const body = await res.json().catch(() => ({}));
      const tx = body?.receipt?.transaction || "";
      if (res.status === 200) {
        paid += 1;
        console.log(`  PAID  ${t.slug}  $${t.usd.toFixed(2)}  tx ${tx ? tx.slice(0, 14) + "…" : "(in X-PAYMENT-RESPONSE)"}`);
      } else {
        failed += 1;
        console.log(`  FAIL  ${t.slug}  HTTP ${res.status}  ${JSON.stringify(body).slice(0, 120)}`);
      }
    } catch (err) {
      failed += 1;
      console.log(`  FAIL  ${t.slug}  ${err.message}`);
    }
  }

  console.log(`settled: ${paid} | failed: ${failed}`);
  const after = await getJson(CDP_MERCHANT);
  console.log(`Bazaar merchant record now reports total: ${after?.pagination?.total ?? "?"} (indexing can lag a few minutes — re-check with: node scripts/canary-pay-all.mjs --dry-run)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
