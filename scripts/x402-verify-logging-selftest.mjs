#!/usr/bin/env node
/**
 * No-spend proof that x402 verify-failure DIAGNOSTICS are captured safely:
 *   - redactFacilitatorBody() keeps diagnostic scalars (invalidReason, status,
 *     payer) but strips signatures/authorizations and nested objects, and bounds
 *     long strings — so a CDP /verify body can be logged without leaking secrets.
 *   - composeFailureReason() folds stage / invalidReason / facilitatorStatus /
 *     declaredNetwork into the single D1 failure_reason column (no schema change)
 *     so the payment-attempts audit trail explains WHY a verify failed.
 *
 * Pure — no network, no money, Node built-ins + repo modules only. Exit 1 on any
 * failure. Mirrors scripts/x402-multinetwork-selftest.mjs style.
 */

import { redactFacilitatorBody } from "../functions/_lib/x402.js";
import { composeFailureReason } from "../functions/_lib/x402-payment-log.js";

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
const eq = (where, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(where, `got ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  }
};

// --- 1. Redaction keeps diagnostic scalars, drops secrets + nested objects ---
{
  const body = {
    isValid: false,
    invalidReason: "insufficient_funds",
    payer: "0xPayer",
    signature:
      "0x2d6a7588d6acca505cbf0d9a4a227e0c52c6c34008c8e8986a1283259764173608a2ce6496642e377d6da8dbbf5836e9",
    authorization: { from: "0xa", to: "0xb", value: "10000", nonce: "0xdead" },
    nested: { anything: "here" },
  };
  const r = redactFacilitatorBody(body);
  eq("redact invalidReason", r.invalidReason, "insufficient_funds");
  eq("redact payer", r.payer, "0xPayer");
  eq("redact isValid", r.isValid, false);
  if (r.signature !== "[redacted]") fail("redact", "signature not redacted");
  if (r.authorization !== "[redacted]") fail("redact", "authorization not redacted");
  if (r.nested !== "[redacted]") fail("redact", "nested object not redacted");
  // The serialized redacted body must contain none of the signature material.
  const s = JSON.stringify(r);
  if (s.includes("2d6a7588") || s.includes("0xdead")) {
    fail("redact", "secret material leaked into redacted body");
  }
}

// --- 2. Redaction bounds long scalar strings ---
{
  const long = "x".repeat(500);
  const r = redactFacilitatorBody({ message: long });
  if (r.message.length > 201) fail("redact-bound", `message not bounded (${r.message.length})`);
  if (!r.message.endsWith("…")) fail("redact-bound", "bounded string missing ellipsis marker");
}

// --- 3. Redaction is null/primitive safe ---
{
  eq("redact null", redactFacilitatorBody(null), null);
  eq("redact undefined", redactFacilitatorBody(undefined), null);
  eq("redact string", redactFacilitatorBody("nope"), "nope");
}

// --- 4. composeFailureReason folds CDP diagnostics into one bounded string ---
{
  const r = composeFailureReason(
    {
      error: "Payment verification failed",
      stage: "verify",
      invalidReason: "insufficient_funds",
      facilitatorStatus: 402,
    },
    "verify_failed"
  );
  if (!r.includes("invalidReason=insufficient_funds")) {
    fail("compose", `missing invalidReason tag: ${r}`);
  }
  if (!r.includes("status=402")) fail("compose", `missing status tag: ${r}`);
  if (!r.includes("stage=verify")) fail("compose", `missing stage tag: ${r}`);
}

// --- 5. composeFailureReason surfaces the declared rail on hard-reject ---
{
  const r = composeFailureReason(
    {
      error: "unsupported_payment_network",
      stage: "select",
      invalidReason: "unsupported_payment_network",
      declaredNetwork: "eip155:137",
    },
    "verify_failed"
  );
  if (!r.includes("network=eip155:137")) fail("compose", `missing declared network: ${r}`);
}

// --- 6. composeFailureReason degrades gracefully ---
{
  eq("compose null", composeFailureReason(null, "verify_failed"), "verify_failed");
  const plain = composeFailureReason({ stage: "auth" }, "verify_failed");
  if (plain !== "auth") fail("compose", `bare stage should be the reason, got ${plain}`);
  // Bounded to 500 chars.
  const big = composeFailureReason({ error: "e".repeat(900), facilitatorStatus: 500 }, "x");
  if (big.length > 500) fail("compose", `not bounded to 500 (${big.length})`);
}

if (failures.length) {
  console.error("x402 verify-logging self-test FAILED:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n${failures.length} issue(s).`);
  process.exit(1);
}

console.log(
  "x402 verify-logging self-test OK — CDP failure bodies are redacted before logging; invalidReason/status/rail persist in the D1 failure_reason."
);
