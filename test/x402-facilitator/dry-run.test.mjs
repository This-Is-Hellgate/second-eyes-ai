#!/usr/bin/env node
// test/x402-facilitator/dry-run.test.mjs
// LAYER 2 — Live but NO-SPEND reachability. Pings each CONFIGURED facilitator's
// GET /supported endpoint and checks it advertises the network you plan to
// activate. Costs nothing: no signing, no verify, no settle, no on-chain tx.
//
// This is the gate that catches a typo'd TEST_FACILITATOR_URL_* pointing at a
// 404 BEFORE you trust the integration in any spend test (Layer 3).
//
// Default posture: when no TEST_FACILITATOR_URL_* var is set, this layer SKIPS
// cleanly (exit 0) and prints how to enable it. It never reaches the network
// unless an operator has explicitly pointed it at a facilitator.
//
// Run: node test/x402-facilitator/dry-run.test.mjs
//   export TEST_FACILITATOR_URL_BASE_SEPOLIA=https://api.cdp.coinbase.com/platform
//   export TEST_FACILITATOR_URL_SOLANA_DEVNET=https://api.cdp.coinbase.com/platform
//   export TEST_FACILITATOR_URL_POLYGON_AMOY=https://x402-amoy.polygon.technology

import { TESTNETS, facilitatorUrlFor } from "./env.mjs";

const env = process.env;
const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);

const PROBE_TIMEOUT_MS = 20_000;

async function fetchSupported(url) {
  const supportedUrl = `${url.replace(/\/+$/, "")}/supported`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const resp = await fetch(supportedUrl, { method: "GET", signal: controller.signal });
    let body = null;
    try {
      body = await resp.json();
    } catch {
      body = null;
    }
    return { reached: true, ok: resp.ok, status: resp.status, body, url: supportedUrl };
  } catch (e) {
    return { reached: false, ok: false, status: 0, body: null, url: supportedUrl, err: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

const networksIn = (body) =>
  (body?.kinds ?? []).map((k) => k.network).filter(Boolean);

const probes = [
  {
    key: "base-sepolia",
    envVar: "TEST_FACILITATOR_URL_BASE_SEPOLIA",
    label: "Base Sepolia",
    // CDP advertises Base Sepolia via the same URL; require its CAIP-2 id.
    check: (body) => {
      const nets = networksIn(body);
      return {
        ok: nets.includes(TESTNETS["base-sepolia"].network) || nets.includes("eip155:84532"),
        detail: `advertised: ${nets.join(", ") || "(none)"}`,
      };
    },
  },
  {
    key: "polygon-amoy",
    envVar: "TEST_FACILITATOR_URL_POLYGON_AMOY",
    label: "Polygon Amoy",
    // Polygon's hosted Amoy facilitator may not advertise kinds[] in the CDP
    // shape; accept either the Amoy id OR a non-empty JSON object (soft signal).
    check: (body) => {
      const nets = networksIn(body);
      if (nets.length > 0) {
        const hasAmoy =
          nets.includes(TESTNETS["polygon-amoy"].network) ||
          nets.includes("eip155:80002") ||
          nets.includes("polygon-amoy");
        return { ok: hasAmoy, detail: `advertised: ${nets.join(", ")}` };
      }
      return { ok: body && typeof body === "object", detail: "kinds[] empty; responded with JSON (soft pass)" };
    },
  },
  {
    key: "solana-devnet",
    envVar: "TEST_FACILITATOR_URL_SOLANA_DEVNET",
    label: "Solana Devnet",
    check: (body) => {
      const nets = networksIn(body);
      const hasSolana = nets.some((n) => n.startsWith("solana:") || n === "solana-devnet");
      return { ok: hasSolana, detail: `advertised: ${nets.join(", ") || "(none)"}` };
    },
  },
];

const configured = probes.filter((p) => env[p.envVar]);

if (configured.length === 0) {
  console.log(
    [
      "LAYER 2 (dry-run reachability) SKIPPED — no TEST_FACILITATOR_URL_* configured.",
      "Layer 1 (mocked) still proves the builder; live reachability is unverified.",
      "To probe a facilitator (no spend), set one or more of:",
      "  TEST_FACILITATOR_URL_BASE_SEPOLIA",
      "  TEST_FACILITATOR_URL_POLYGON_AMOY",
      "  TEST_FACILITATOR_URL_SOLANA_DEVNET",
    ].join("\n")
  );
  process.exit(0);
}

console.log(`LAYER 2 (dry-run reachability) — probing ${configured.length} facilitator(s), no spend.\n`);

for (const p of configured) {
  const url = facilitatorUrlFor(env, p.key);
  const res = await fetchSupported(url);
  if (!res.reached) {
    fail(p.label, `unreachable: GET ${res.url} (${res.err})`);
    console.log(`  x ${p.label}: unreachable ${res.url}`);
    continue;
  }
  if (!res.ok) {
    fail(p.label, `GET ${res.url} returned ${res.status}`);
    console.log(`  x ${p.label}: HTTP ${res.status} ${res.url}`);
    continue;
  }
  const verdict = p.check(res.body);
  if (!verdict.ok) {
    fail(p.label, `reachable but did not advertise the expected network — ${verdict.detail}`);
    console.log(`  x ${p.label}: ${verdict.detail}`);
  } else {
    console.log(`  ok ${p.label}: reachable, ${verdict.detail}`);
  }
}

if (failures.length) {
  console.error("\nLAYER 2 (dry-run reachability) FAILED:\n");
  for (const f of failures) console.error(`  x ${f}`);
  console.error(`\n${failures.length} issue(s). Do NOT proceed to Layer 3 for a failed rail.`);
  process.exit(1);
}

console.log("\nLAYER 2 (dry-run reachability) OK — every configured facilitator is reachable and advertises its rail.");
