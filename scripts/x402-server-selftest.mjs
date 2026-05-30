#!/usr/bin/env node
/**
 * Zero-spend proof that OUR server code (functions/_lib/x402.js) now emits a 402
 * that the official @x402/fetch v2 client can actually pay. Fake network, no money.
 */
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildProductPaymentRequirements,
  payment402BodyForProduct,
  payment402Headers,
} from "../functions/_lib/x402.js";

const NETWORK = "eip155:8453";
const URL_UNDER_TEST = "https://secondeyesai.com/api/bar/x402/index-check";
const PAYTO = "0xFb8915074cC941f5Ab95E6001c45287b8EeC4427";

const product = {
  kind: "nano",
  id: "bazaar-index-check",
  slug: "bazaar-index-check",
  tool: "x402-survival",
  priceUsd: 0.25,
  access: "paid",
  description: "bazaar-index-check: is your x402 endpoint indexed on the CDP Bazaar?",
};
const env = { X402_PAYTO: PAYTO, X402_NETWORK: "base" };

// Build the 402 exactly as our server does.
const requirements = buildProductPaymentRequirements(product, URL_UNDER_TEST, env);
const body = payment402BodyForProduct(requirements, product, undefined, "https://secondeyesai.com");
const headers = payment402Headers(requirements, undefined, {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
});

console.log("Our PAYMENT-REQUIRED header decodes to:");
console.log(JSON.stringify(JSON.parse(Buffer.from(headers["PAYMENT-REQUIRED"], "base64").toString("utf8")), null, 2));

function loadKey() {
  if (process.env.CANARY_WALLET_KEY) {
    const k = process.env.CANARY_WALLET_KEY.trim();
    return k.startsWith("0x") ? k : `0x${k}`;
  }
  const p = join(dirname(fileURLToPath(import.meta.url)), "..", "cdp-credentials.local.json");
  if (existsSync(p)) {
    const j = JSON.parse(readFileSync(p, "utf8"));
    if (j.CANARY_WALLET_KEY) {
      const k = String(j.CANARY_WALLET_KEY).trim();
      return k.startsWith("0x") ? k : `0x${k}`;
    }
  }
  return null;
}

function fakeFetch() {
  let calls = 0;
  return async (input) => {
    calls++;
    const req = input instanceof Request ? input : new Request(input);
    if (calls === 1) return new Response(JSON.stringify(body), { status: 402, headers });
    const sig = req.headers.get("PAYMENT-SIGNATURE") || req.headers.get("X-PAYMENT") || "";
    return new Response(JSON.stringify({ ok: true, sawSignature: Boolean(sig) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

async function main() {
  const key = loadKey();
  if (!key) {
    console.error("No CANARY_WALLET_KEY.");
    process.exit(1);
  }
  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ chain: base, transport: http() });
  const signer = toClientEvmSigner(account, publicClient);
  const client = new x402Client().register(NETWORK, new ExactEvmScheme(signer));
  const wrapped = wrapFetchWithPayment(fakeFetch(), client);

  try {
    const res = await wrapped(URL_UNDER_TEST, { headers: { Accept: "application/json" } });
    const json = await res.json().catch(() => ({}));
    console.log(`\nRESULT: status=${res.status}  serverSawSignature=${json.sawSignature}`);
    if (res.status === 200 && json.sawSignature) {
      console.log("PASS: our server's 402 is now payable by the official v2 client.");
    } else {
      console.log("FAIL: client did not complete payment.");
      process.exit(1);
    }
  } catch (e) {
    console.log(`\nFAIL — client threw: ${e.message}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
