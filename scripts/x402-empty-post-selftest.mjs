#!/usr/bin/env node
/**
 * No-spend proof that an EMPTY / blank POST body reaches the x402 paywall (402)
 * on every paid x402 door, instead of bouncing as 400 invalid_json BEFORE the
 * paywall.
 *
 * Background: a wallet/Codex agent that discovers an x402 route commonly probes
 * it with a bare POST (empty body, or Content-Type: application/json with no
 * payload). Request.json() rejects on an empty body, so a handler that parses
 * with `await request.json()` inside try/catch returns 400 to that probe — the
 * agent then can't see the 402 PAYMENT-REQUIRED it needs to pay. help-me was
 * already fixed (scripts/help-me-post-selftest.mjs); this covers the sibling
 * doors that shared the same broken pattern:
 *
 *   transcribe, extract, schema-repair, payment-confirmation-check,
 *   context-pressure, index-check, doctor
 *
 * Contract asserted per door:
 *   - empty POST (no body)              → 402  (bare probe reaches paywall)
 *   - explicit empty-string body        → 402
 *   - whitespace-only body              → 402
 *   - Content-Type: application/json + empty body → 402  (the doctor trap)
 *   - well-formed JSON, no payment hdr  → 402
 *   - malformed NON-empty body          → 400 invalid_json
 *
 * Pure: no network, no D1 (env without DB), no real keys. The unpaid path in
 * handlePaidFetch returns the 402 before any settlement. Exit 1 on any failure.
 */

import { onRequestPost as transcribe } from "../functions/api/bar/x402/transcribe.js";
import { onRequestPost as extract } from "../functions/api/bar/x402/extract.js";
import { onRequestPost as schemaRepair } from "../functions/api/bar/x402/schema-repair.js";
import { onRequestPost as paymentConfirmationCheck } from "../functions/api/bar/x402/payment-confirmation-check.js";
import { onRequestPost as contextPressure } from "../functions/api/bar/x402/context-pressure.js";
import { onRequestPost as indexCheck } from "../functions/api/bar/x402/index-check.js";
import { onRequestPost as doctor } from "../functions/api/bar/x402/doctor.js";

const failures = [];
const eq = (where, got, want) => {
  if (got !== want) failures.push(`${where}: got ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
};

// X402_PAYTO present so buildProductPaymentRequirements yields a real 402; no DB
// so no counter write. No facilitator needed — the unpaid path never settles.
const env = { X402_PAYTO: "0xFb8915074cC941f5Ab95E6001c45287b8EeC4427", X402_NETWORK: "base" };

const ctx = (request) => ({ request, env });

const DOORS = [
  ["transcribe", transcribe, "/api/bar/x402/transcribe"],
  ["extract", extract, "/api/bar/x402/extract"],
  ["schema-repair", schemaRepair, "/api/bar/x402/schema-repair"],
  ["payment-confirmation-check", paymentConfirmationCheck, "/api/bar/x402/payment-confirmation-check"],
  ["context-pressure", contextPressure, "/api/bar/x402/context-pressure"],
  ["index-check", indexCheck, "/api/bar/x402/index-check"],
  ["doctor", doctor, "/api/bar/x402/doctor"],
];

// A well-formed body that satisfies each door's input shape WITHOUT a payment
// header — still must be 402 (no payment = paywall), proving valid input alone
// never slips past the gate.
const VALID_BODY = {
  transcribe: { url: "https://storage.googleapis.com/x/y.mp3", kind: "audio" },
  extract: { url: "https://example.com/doc.pdf", doc_type: "generic" },
  "schema-repair": { error: "Expected object, received string", tool: "some-mcp" },
  "payment-confirmation-check": { tx: "0xabc", status: "success" },
  "context-pressure": { remaining_context: "5%", state: "near limit" },
  "index-check": { payTo: "0xFb8915074cC941f5Ab95E6001c45287b8EeC4427", url: "https://example.com/x" },
  doctor: { url: "https://example.com/some/endpoint" },
};

const req = (path, { body, ct = "application/json" } = {}) =>
  new Request(`https://secondeyesai.com${path}`, {
    method: "POST",
    headers: ct ? { "Content-Type": ct } : {},
    ...(body === undefined ? {} : { body }),
  });

for (const [name, handler, path] of DOORS) {
  // 1. Empty POST (no body) → 402.
  eq(`${name} empty-post`, (await handler(ctx(req(path)))).status, 402);

  // 2. Explicit empty-string body → 402.
  eq(`${name} empty-string`, (await handler(ctx(req(path, { body: "" })))).status, 402);

  // 3. Whitespace-only body → 402.
  eq(`${name} whitespace`, (await handler(ctx(req(path, { body: "   \n  " })))).status, 402);

  // 4. Content-Type: application/json + empty body → 402 (the doctor trap, and the
  //    default header a fetch-based agent sends with a bodyless POST).
  eq(
    `${name} json-ct-empty`,
    (await handler(ctx(req(path, { body: "", ct: "application/json" })))).status,
    402
  );

  // 5. Well-formed JSON, no payment header → 402.
  eq(
    `${name} valid-json-no-pay`,
    (await handler(ctx(req(path, { body: JSON.stringify(VALID_BODY[name]) })))).status,
    402
  );

  // 6. Malformed NON-empty body → 400 invalid_json (must NOT be treated as {}).
  {
    const res = await handler(ctx(req(path, { body: "{not json" })));
    eq(`${name} malformed-status`, res.status, 400);
    const json = await res.json().catch(() => ({}));
    eq(`${name} malformed-error`, json.error, "invalid_json");
  }
}

if (failures.length) {
  console.error("x402 empty-POST self-test FAILED:\n");
  for (const f of failures) console.error(`  x ${f}`);
  console.error(`\n${failures.length} failure(s).`);
  process.exit(1);
}

console.log(
  `x402 empty-POST self-test OK — ${DOORS.length} paid doors: empty/blank/json-ct-empty POST reaches the paywall (402); malformed non-empty body still 400.`
);
