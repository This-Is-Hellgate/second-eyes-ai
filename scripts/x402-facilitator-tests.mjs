#!/usr/bin/env node
/**
 * Runner for the CDP x402 facilitator integration test harness.
 *
 * Runs the safe layers in order and stops on the first failure:
 *   Layer 1 — mocked verify/settle (always; no network, no spend)
 *   Layer 2 — dry-run /supported reachability (skips cleanly if no URLs set)
 *
 * Layer 3 (live settlement, real testnet USDC) is intentionally NOT run here —
 * it is triple-gated and meant to be invoked deliberately:
 *   node test/x402-facilitator/settlement.test.mjs
 *
 * Exit 1 if any run-layer fails. Mirrors scripts/*-selftest.mjs style.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const layers = [
  ["Layer 1 (mocked)", "test/x402-facilitator/mocked.test.mjs"],
  ["Layer 2 (dry-run)", "test/x402-facilitator/dry-run.test.mjs"],
];

for (const [label, file] of layers) {
  console.log(`\n=== ${label}: ${file} ===`);
  const res = spawnSync(process.execPath, [join(ROOT, file)], { stdio: "inherit" });
  if (res.status !== 0) {
    console.error(`\n${label} FAILED (exit ${res.status}). Stopping.`);
    process.exit(1);
  }
}

console.log(
  "\nx402 facilitator harness OK (Layers 1-2). Layer 3 (live settlement) is opt-in: " +
    "see test/x402-facilitator/README.md."
);
