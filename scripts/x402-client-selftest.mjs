#!/usr/bin/env node
/**
 * Zero-spend proof: does adding the PAYMENT-REQUIRED header actually let the
 * official @x402/fetch v2 client get PAST the parse error and sign a payment?
 *
 * No network settle, no facilitator, no money. We feed a FAKE fetch:
 *   - 1st call: 402 with our candidate shape (body +/- PAYMENT-REQUIRED header)
 *   - 2nd call: 200 (as if the server accepted the signature)
 * and watch where the real client succeeds or throws.
 *
 * Run:  node scripts/x402-client-selftest.mjs
 */
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const NETWORK = "eip155:8453";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913";
const PAYTO = "0xFb8915074cC941f5Ab95E6001c45287b8EeC4427";
const URL_UNDER_TEST = "https://secondeyesai.com/api/bar/x402/index-check";

// The canonical v2 payment-required object (oatp-shaped: resource as OBJECT,
// clean accepts, EIP-712 domain in extra). This is what our server SHOULD emit.
const canonical = {
  x402Version: 2,
  error: "PAYMENT-SIGNATURE header is required",
  resource: {
    url: URL_UNDER_TEST,
    description: "bazaar-index-check: is your x402 endpoint indexed on the CDP Bazaar?",
    mimeType: "application/json",
  },
  accepts: [
    {
      scheme: "exact",
      network: NETWORK,
      amount: "250000",
      asset: USDC,
      payTo: PAYTO,
      maxTimeoutSeconds: 600,
      extra: { name: "USD Coin", version: "2" },
    },
  ],
  extensions: { bazaar: { info: { input: { type: "http", method: "GET" } } } },
};

// Mirror @x402/core safeBase64Encode exactly (standard base64 of UTF-8 JSON).
function encodePaymentRequiredHeader(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function loadKey() {
  if (process.env.CANARY_WALLET_KEY) {
    const k = process.env.CANARY_WALLET_KEY.trim();
    return k.startsWith("0x") ? k : `0x${k}`;
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const p = join(root, "cdp-credentials.local.json");
  if (existsSync(p)) {
    const j = JSON.parse(readFileSync(p, "utf8"));
    if (j.CANARY_WALLET_KEY) {
      const k = String(j.CANARY_WALLET_KEY).trim();
      return k.startsWith("0x") ? k : `0x${k}`;
    }
  }
  return null;
}

function buildClient(key) {
  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: base, transport: http() });
  const signer = toClientEvmSigner(account, publicClient);
  return new x402Client().register(NETWORK, new ExactEvmScheme(signer));
}

/** Fake fetch: first 402 (with the shape we're testing), then 200. */
function fakeFetch({ withHeader }) {
  let calls = 0;
  return async (input) => {
    calls++;
    const req = input instanceof Request ? input : new Request(input);
    if (calls === 1) {
      const headers = { "Content-Type": "application/json" };
      if (withHeader) headers["PAYMENT-REQUIRED"] = encodePaymentRequiredHeader(canonical);
      // Body mimics our CURRENT server: x402Version 2, resource as STRING.
      const body = JSON.stringify({ ...canonical, resource: canonical.resource.url });
      return new Response(body, { status: 402, headers });
    }
    // Second call: the client attached PAYMENT-SIGNATURE; pretend server accepted.
    const sig = req.headers.get("PAYMENT-SIGNATURE") || req.headers.get("X-PAYMENT") || "";
    return new Response(JSON.stringify({ ok: true, sawSignature: Boolean(sig) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

async function scenario(label, { withHeader }, client) {
  const wrapped = wrapFetchWithPayment(fakeFetch({ withHeader }), client);
  try {
    const res = await wrapped(URL_UNDER_TEST, { headers: { Accept: "application/json" } });
    const body = await res.json().catch(() => ({}));
    console.log(`\n[${label}]  status=${res.status}  serverSawSignature=${body.sawSignature}`);
    console.log(`  => PASS: client parsed requirements and signed a payment offline.`);
    return true;
  } catch (e) {
    console.log(`\n[${label}]  THREW: ${e.message}`);
    return false;
  }
}

async function main() {
  const key = loadKey();
  if (!key) {
    console.error("No CANARY_WALLET_KEY (env or cdp-credentials.local.json).");
    process.exit(1);
  }
  const client = buildClient(key);
  console.log("Self-test: real @x402/fetch v2 client, real signer, FAKE network (no spend).");

  const without = await scenario("NO PAYMENT-REQUIRED header (current prod shape)", { withHeader: false }, client);
  const withh = await scenario("WITH PAYMENT-REQUIRED header (proposed fix)", { withHeader: true }, client);

  console.log("\n=== VERDICT ===");
  console.log(`  current shape (no header): ${without ? "works (so header is NOT the issue)" : "fails to parse — reproduces prod error"}`);
  console.log(`  with header:               ${withh ? "parses + signs — fix is real" : "still fails — header alone is NOT enough"}`);
  if (!without && withh) {
    console.log("\n  CONCLUSION: the missing PAYMENT-REQUIRED header is the (a) blocker. Adding it lets a real v2 client pay.");
  } else if (without) {
    console.log("\n  CONCLUSION: header is not the cause — do NOT ship this; investigate further.");
  } else {
    console.log("\n  CONCLUSION: header necessary but not sufficient — more is broken. Do not claim victory.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
