#!/usr/bin/env node
/**
 * Push x402 secrets to Cloudflare Pages (second-eyes-ai).
 * Reads .env.local in repo root. Never commit .env.local.
 *
 * Usage: node scripts/push-coinbase-secrets.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const project = "second-eyes-ai";
const envPath = join(root, ".env.local");
const credPath = join(root, "cdp-credentials.local.json");

function loadJson(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function putSecret(name, value) {
  if (!value) {
    console.log(`skip ${name} (empty)`);
    return false;
  }
  const r = spawnSync(
    "npx",
    ["wrangler", "pages", "secret", "put", name, "--project-name", project],
    {
      cwd: root,
      input: value,
      encoding: "utf8",
      shell: true,
      stdio: ["pipe", "inherit", "inherit"],
    }
  );
  if (r.status !== 0) {
    console.error(`failed ${name}`);
    return false;
  }
  console.log(`ok ${name}`);
  return true;
}

const env = { ...loadJson(credPath), ...loadEnvFile(envPath) };
const accessSecret = env.ACCESS_TOKEN_SECRET || randomBytes(32).toString("hex");

const secrets = {
  ACCESS_TOKEN_SECRET: accessSecret,
  X402_FACILITATOR_URL: env.X402_FACILITATOR_URL || "https://api.cdp.coinbase.com/platform",
  X402_PAYTO: env.X402_PAYTO,
  CDP_API_KEY_NAME: env.CDP_API_KEY_NAME || env.CDP_API_KEY_ID,
  CDP_API_KEY_SECRET: env.CDP_API_KEY_SECRET,
  CDP_API_KEY: env.CDP_API_KEY,
  OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
};

console.log("Pushing secrets to Cloudflare Pages:", project);

let ok = 0;
for (const [name, value] of Object.entries(secrets)) {
  if (putSecret(name, value)) ok += 1;
}

if (!env.X402_PAYTO) {
  console.log("\n⚠ X402_PAYTO missing — add Base wallet to .env.local and re-run.");
}
if (!env.CDP_API_KEY_NAME && !env.CDP_API_KEY_ID && !env.CDP_API_KEY) {
  console.log("⚠ CDP API key missing — create Secret API key in portal.cdp.coinbase.com");
}

if (!existsSync(envPath)) {
  console.log("\nWrote ACCESS_TOKEN_SECRET only. Copy .env.example → .env.local and fill CDP fields.");
  const sample = join(root, ".env.example");
  console.log("Template:", sample);
}

console.log(`\nDone (${ok} secrets pushed). Redeploy Pages for functions to pick up changes.`);
