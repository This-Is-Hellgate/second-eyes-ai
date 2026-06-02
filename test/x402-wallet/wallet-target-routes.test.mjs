#!/usr/bin/env node
// test/x402-wallet/wallet-target-routes.test.mjs
// No-network proof of the wallet-agent-target routing contract.
//
// Wallet-equipped agents that read public/.well-known/wallet-agent-targets/ have
// NO Second Eyes session. The session-gated /api/bar/services/{slug} routes are
// unreachable to them (services require an active session after the paid retry),
// so a profile that recommends a /api/bar/services/ URL sends a one-shot wallet
// agent into a dead end. Every recommended route MUST be the session-less
// /api/bar/x402/{slug} twin instead.
//
// This test:
//   1. Every profile JSON parses.
//   2. NO profile string anywhere references /api/bar/services/.
//   3. index.json canonical_routes + every profile's recommended_second_eyes_routes[].url
//      point at /api/bar/x402/ (the session-less twin).
//
// Run: node test/x402-wallet/wallet-target-routes.test.mjs   (exit 1 on any failure)

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "../../public/.well-known/wallet-agent-targets");
const SERVICES = "/api/bar/services/";
const X402 = "/api/bar/x402/";

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);

const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
if (files.length === 0) fail("discovery", "no wallet-agent-target profiles found");

for (const file of files) {
  const raw = readFileSync(join(DIR, file), "utf8");

  // 1. Parses.
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    fail(file, `invalid JSON: ${e.message}`);
    continue;
  }

  // 2. No /api/bar/services/ anywhere in the file (grep-style raw scan catches
  //    canonical_routes, recommended_second_eyes_routes[].url, and any prose).
  if (raw.includes(SERVICES)) {
    fail(file, `recommends session-gated ${SERVICES} — wallet agents have no session; use ${X402} twins`);
  }

  // 3. Structured check: every recommended route URL is the session-less x402 twin.
  const routes = json.recommended_second_eyes_routes;
  if (Array.isArray(routes)) {
    for (const r of routes) {
      if (r?.url && !r.url.includes(X402)) {
        fail(file, `recommended_second_eyes_routes url not an x402 twin: ${r.url}`);
      }
    }
  }
  if (json.canonical_routes && typeof json.canonical_routes === "object") {
    for (const [key, url] of Object.entries(json.canonical_routes)) {
      if (typeof url === "string" && !url.includes(X402)) {
        fail(file, `canonical_routes.${key} not an x402 twin: ${url}`);
      }
    }
  }
}

if (failures.length) {
  console.error("wallet-target routing test FAILED:\n");
  for (const f of failures) console.error(`  x ${f}`);
  console.error(`\n${failures.length} failure(s).`);
  process.exit(1);
}

console.log(
  `wallet-target routing test OK — ${files.length} profile(s) parse; none recommend ${SERVICES}; all routes are session-less ${X402} twins.`
);
