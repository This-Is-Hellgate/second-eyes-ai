#!/usr/bin/env node
/**
 * Polygon canary PREFLIGHT — no-spend, repo-native. No Cursor/browser composer.
 *
 * Answers the one question before any Polygon canary spend: "if I enabled Polygon
 * right now, what would the server actually advertise, and is the live help-me door
 * still serving a payable 402?" It does this WITHOUT signing, verifying, settling, or
 * sending any transaction.
 *
 * What it does:
 *   1. Resolves the active + planned rails for a simulated env (mirrors what the
 *      Cloudflare Worker would build) using the real rail registry in
 *      functions/_lib/x402-networks.js — so the print is authoritative, not a guess.
 *   2. Live no-spend probe of the production help-me door: GET returns 402 with a
 *      non-empty accepts[] and a PAYMENT-REQUIRED header (the door an agent pays).
 *      Prints which networks the LIVE server currently advertises.
 *   3. Cross-checks: is Polygon (eip155:137) advertised live? If not, prints the
 *      exact env flags to flip (X402_POLYGON_ENABLED=1, optional X402_POLYGON_PAY_TO).
 *
 * Pure Node built-ins + repo modules. No viem, no @x402, no keys. Safe to run in CI.
 *
 * Usage:
 *   node scripts/polygon-canary-preflight.mjs
 *   POLYGON_CANARY_TARGET_URL=https://secondeyesai.com/api/bar/x402/help-me node scripts/polygon-canary-preflight.mjs
 *
 * Mock mode (CI, no network): POLYGON_CANARY_MOCK=1 — skips the live probe and proves
 * the rail-resolution logic only, exit 0.
 *
 * Exit codes: 0 = preflight clean; 1 = preflight failed (live door not payable, or a
 * requested check failed). A non-advertised Polygon rail is reported, not a failure —
 * preflight tells you the state; it does not require Polygon to be live.
 */

import {
  resolveActiveNetworks,
  plannedNetworks,
  acceptedNetworkIds,
  x402ConfigWarnings,
  POLYGON_NETWORK,
} from "../functions/_lib/x402-networks.js";
import { POLYGON_EMERGENCY_OVERRIDE_SENTINEL } from "../functions/_lib/x402-rail-activation.js";

const env = process.env;

const DEFAULT_TARGET = "https://secondeyesai.com/api/bar/x402/help-me?state=I+am+looping";
const PROBE_TIMEOUT_MS = 20_000;
const POLYGON_ID = POLYGON_NETWORK.id; // "eip155:137"

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);

function log(line = "") {
  console.log(line);
}

/**
 * Simulate the env the Worker WOULD see if an operator enabled Polygon, using the
 * caller's real production-ish values where given. We never read secrets here — only
 * the public payTo / flag shape — so the print matches resolveActiveNetworks() exactly.
 */
function simulatedEnv(withPolygon) {
  // Use the operator's REAL payTo only. A synthetic fallback (e.g.
  // "0xPreflightSimPayTo") would make resolveActiveNetworks() report Base/Polygon
  // as accept-ready even when NO payTo is configured — masking the exact misconfig
  // this preflight exists to catch. With no real payTo set, leave X402_PAYTO unset
  // so the resolver returns an empty accepts[] and the verdict flags it.
  const payTo = env.X402_PAYTO || env.POLYGON_CANARY_EXPECTED_PAYTO || null;
  const sim = {};
  if (payTo) sim.X402_PAYTO = payTo;
  if (withPolygon) {
    sim[POLYGON_NETWORK.enable_env] = "1";
    if (env.X402_POLYGON_PAY_TO) sim[POLYGON_NETWORK.payto_env] = env.X402_POLYGON_PAY_TO;
    // The activation gate keeps Polygon out of accepts[] until a record proves it.
    // The canary runs BEFORE that record exists (it is the proof), so it advertises
    // via the emergency override — mirror that here so the preflight shows the same
    // accept-ready posture the canary will actually build.
    sim.X402_POLYGON_EMERGENCY_OVERRIDE = POLYGON_EMERGENCY_OVERRIDE_SENTINEL;
  }
  return sim;
}

function printRails(label, simEnv) {
  const active = resolveActiveNetworks(simEnv);
  const planned = plannedNetworks(simEnv);
  const warnings = x402ConfigWarnings(simEnv);
  log(`  ${label}`);
  log(`    active accepts[] : ${active.map((a) => a.network.id).join(", ") || "(none)"}`);
  for (const a of active) {
    log(`      - ${a.network.key.padEnd(7)} ${a.network.id}  payTo=${a.payTo}  asset=${a.network.asset}`);
  }
  log(`    planned (not in accepts[]): ${planned.map((p) => p.network).join(", ") || "(none)"}`);
  if (warnings.length) {
    for (const w of warnings) log(`    ! config warning [${w.code}]: ${w.message}`);
  }
  return { active, planned, warnings };
}

const networksFromBody = (body) =>
  Array.isArray(body?.accepts) ? body.accepts.map((a) => a.network).filter(Boolean) : [];

/** Decode a base64 PAYMENT-REQUIRED header → object (standard or url-safe base64). */
function decodePaymentRequired(header) {
  if (!header) return null;
  try {
    const n = header.trim().replace(/-/g, "+").replace(/_/g, "/");
    const pad = n.length % 4 === 0 ? "" : "=".repeat(4 - (n.length % 4));
    return JSON.parse(Buffer.from(n + pad, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function probeLive(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await resp.json().catch(() => ({}));
    const prHeader = resp.headers.get("PAYMENT-REQUIRED");
    return { reached: true, status: resp.status, body, paymentRequired: decodePaymentRequired(prHeader), hasPrHeader: !!prHeader };
  } catch (e) {
    return { reached: false, status: 0, body: null, err: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  log("=== Polygon canary PREFLIGHT (no spend) ===\n");

  // --- Section 1: rail resolution (authoritative, from the real registry) -------
  log("[1] Rail resolution (what the Worker would advertise):");
  const realPayTo = env.X402_PAYTO || env.POLYGON_CANARY_EXPECTED_PAYTO || null;
  if (!realPayTo) {
    log(
      "  ! no X402_PAYTO / POLYGON_CANARY_EXPECTED_PAYTO set — modeling with NO payTo " +
        "(empty accepts[] expected). Set the real payTo to model an accept-ready posture."
    );
  }
  printRails("Current posture (Polygon NOT enabled):", simulatedEnv(false));
  log("");
  const polySim = printRails("If X402_POLYGON_ENABLED=1 + emergency override (canary target posture):", simulatedEnv(true));
  const polyWouldActivate = polySim.active.some((a) => a.network.id === POLYGON_ID);
  if (!polyWouldActivate && !realPayTo && env.POLYGON_CANARY_MOCK === "1") {
    // Mock mode with no real payTo: an empty accepts[] is the EXPECTED offline
    // posture, not a failure. The rail-resolution LOGIC is what mock mode proves
    // (the flag+override path runs); a real payTo only resolves with secrets the
    // CI run deliberately lacks. Do NOT fabricate one (C-018) — report and pass.
    log(
      `\n  ! no payTo resolved (expected in mock mode without X402_PAYTO). Rail-resolution ` +
        `logic exercised; set X402_PAYTO to model an accept-ready Polygon posture before a live run.`
    );
  } else if (!polyWouldActivate) {
    fail(
      "rail-resolution",
      `Polygon would NOT enter accepts[] even with ${POLYGON_NETWORK.enable_env}=1 + the canary override — ` +
        `no EVM payTo resolved. Set X402_PAYTO (or ${POLYGON_NETWORK.payto_env}).`
    );
  } else {
    log(
      `\n  ok: with ${POLYGON_NETWORK.enable_env}=1 + the canary emergency override, Polygon (${POLYGON_ID}) ` +
        `would be accept-ready. NOTE: in production the flag ALONE advertises nothing — a valid activation ` +
        `record is required (this preflight uses the override only to model the proving run).`
    );
  }
  log("");

  // --- Section 2: live no-spend probe of the help-me door -----------------------
  if (env.POLYGON_CANARY_MOCK === "1") {
    log("[2] Live help-me probe SKIPPED — POLYGON_CANARY_MOCK=1 (CI, no network).");
    log("    Rail-resolution logic above is fully exercised offline.\n");
  } else {
    const target = env.POLYGON_CANARY_TARGET_URL || DEFAULT_TARGET;
    log(`[2] Live help-me probe (no spend): GET ${target}`);
    const res = await probeLive(target);
    if (!res.reached) {
      fail("live-probe", `unreachable: ${res.err}`);
      log(`    x unreachable: ${res.err}`);
    } else if (res.status !== 402) {
      fail("live-probe", `expected HTTP 402, got ${res.status}`);
      log(`    x HTTP ${res.status} (expected 402 payment-required)`);
    } else {
      const bodyNets = networksFromBody(res.body);
      const prNets = networksFromBody(res.paymentRequired);
      const liveNets = bodyNets.length ? bodyNets : prNets;
      if (liveNets.length === 0) {
        fail("live-probe", "402 returned but accepts[] is empty (door not payable)");
        log("    x 402 with empty accepts[] — agents cannot pay this door");
      } else {
        log(`    ok HTTP 402, payable. live accepts[]: ${liveNets.join(", ")}`);
        log(`       PAYMENT-REQUIRED header present: ${res.hasPrHeader ? "yes" : "NO (agents read requirements here)"}`);
        if (!res.hasPrHeader) fail("live-probe", "402 missing PAYMENT-REQUIRED header (v2 clients read requirements there)");
        const livePolygon = liveNets.includes(POLYGON_ID);
        log(
          livePolygon
            ? `       Polygon (${POLYGON_ID}) IS advertised live — rail already active in production.`
            : `       Polygon (${POLYGON_ID}) is NOT advertised live yet (expected: rail disabled after the failed canary).`
        );
      }
    }
    log("");
  }

  // --- Verdict ------------------------------------------------------------------
  if (failures.length) {
    log("PREFLIGHT FAILED:");
    for (const f of failures) log(`  x ${f}`);
    log("\nDo NOT proceed to the spend canary until preflight is clean.");
    process.exit(1);
  }
  log("PREFLIGHT OK — door payable, rail resolution sane. See docs/polygon-canary.md for the next step.");
}

main().catch((err) => {
  console.error("\nPREFLIGHT CRASHED:", err?.message || err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
