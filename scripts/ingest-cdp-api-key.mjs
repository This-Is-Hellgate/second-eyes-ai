#!/usr/bin/env node
/**
 * Save CDP Secret API key into cdp-credentials.local.json and push to Cloudflare.
 *
 * Usage (when parked, after creating key in portal):
 *   node scripts/ingest-cdp-api-key.mjs --name "organizations/.../apiKeys/..." --secret-file "C:\path\to\cdp_api_key.json"
 *
 * Or paste into cdp-credentials.local.json manually:
 *   CDP_API_KEY_NAME, CDP_API_KEY_SECRET (PEM with \n escapes)
 * Then: node scripts/push-coinbase-secrets.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const credPath = join(root, "cdp-credentials.local.json");

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function saveCred(patch) {
  let base = {};
  if (existsSync(credPath)) {
    try {
      base = loadJson(credPath);
    } catch {
      base = {};
    }
  }
  writeFileSync(credPath, JSON.stringify({ ...base, ...patch }, null, 2), "utf8");
}

const args = process.argv.slice(2);
let keyName = "";
let secretFile = "";

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--name" && args[i + 1]) keyName = args[++i];
  if (args[i] === "--secret-file" && args[i + 1]) secretFile = args[++i];
}

if (secretFile) {
  const raw = loadJson(secretFile);
  keyName = keyName || raw.name || raw.id || raw.key_name || "";
  const secret = raw.privateKey || raw.private_key || raw.secret || raw.key;
  if (!keyName || !secret) {
    console.error("Could not parse name/secret from", secretFile);
    process.exit(1);
  }
  saveCred({
    CDP_API_KEY_NAME: keyName,
    CDP_API_KEY_SECRET: typeof secret === "string" ? secret : JSON.stringify(secret),
  });
  console.log("Saved CDP API key to", credPath);
} else if (!existsSync(credPath)) {
  console.error("Missing cdp-credentials.local.json. Run generate-receive-wallet.mjs first.");
  process.exit(1);
}

const push = spawnSync("node", ["scripts/push-coinbase-secrets.mjs"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
  stdio: "inherit",
});
process.exit(push.status ?? 1);
