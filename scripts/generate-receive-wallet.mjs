#!/usr/bin/env node
/** Generate a Base receive wallet for X402_PAYTO. Saves to cdp-credentials.local.json (gitignored). */
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "cdp-credentials.local.json");

let existing = {};
if (existsSync(outPath)) {
  try {
    existing = JSON.parse(readFileSync(outPath, "utf8"));
  } catch {
    existing = {};
  }
}

if (existing.X402_PAYTO) {
  console.log("X402_PAYTO already set:", existing.X402_PAYTO);
  process.exit(0);
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);
const payload = {
  ...existing,
  X402_PAYTO: account.address,
  receive_wallet_private_key: privateKey,
  note: "Rotate this wallet before mainnet volume. Fund with Base USDC for testing payouts.",
  created_at: new Date().toISOString(),
};

writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
console.log("Wrote", outPath);
console.log("X402_PAYTO=", account.address);
