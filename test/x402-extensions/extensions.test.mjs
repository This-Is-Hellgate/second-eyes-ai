#!/usr/bin/env node
// test/x402-extensions/extensions.test.mjs
// Unit tests for the repo-side x402 v2 extension surface in
// functions/_lib/x402-extensions.js. No network, no spend, no env required.
//
// Asserts the teardown item-3 contracts:
//   - bazaar metadata carries serviceName/tags/iconUrl
//   - payment-identifier extension is required:true; idempotency decision dedupes
//   - auth-hints metadata present
//   - offer/receipt is signed + deterministic + verifiable (HMAC)
//   - batch-settlement commitment model: accrue, cap-guard, close (live=false)
//   - auth-capture: authorize max → capture ≤ max → void (live=false)
//   - EIP-2612 permit typed-data builder + sponsorship metadata (live=false)
//   - allExtensions merges every extension key
//
// Run: node test/x402-extensions/extensions.test.mjs   (exit 1 on any failure)

import {
  bazaarMetadataExtension,
  paymentIdentifierExtension,
  paymentIdentityDecision,
  normalizeIdentifier,
  authHintsExtension,
  offerReceiptExtension,
  canonicalJson,
  buildReceiptBody,
  signReceipt,
  verifyReceipt,
  batchSettlementExtension,
  openBatchCommitment,
  accrueToCommitment,
  closeBatchCommitment,
  authCaptureExtension,
  authorizeMax,
  captureActual,
  voidAuthorization,
  eip2612SponsorshipExtension,
  buildPermitTypedData,
  allExtensions,
  BASE_CAIP2,
} from "../../functions/_lib/x402-extensions.js";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ENV = { ACCESS_TOKEN_SECRET: "test-secret-do-not-use-in-prod" };

async function main() {
  // --- Bazaar metadata ---
  const bz = bazaarMetadataExtension({ kind: "lounge", slug: "loop-detect" }).bazaar_metadata.info;
  check("bazaar.serviceName present", typeof bz.serviceName === "string" && bz.serviceName.length > 0);
  check("bazaar.tags is non-empty array", Array.isArray(bz.tags) && bz.tags.length > 0);
  check("bazaar.tags includes slug", bz.tags.includes("loop-detect"));
  check("bazaar.iconUrl is https url", /^https:\/\//.test(bz.iconUrl));

  // --- Payment-identifier + idempotency ---
  const pid = paymentIdentifierExtension().payment_identifier.info;
  check("payment_identifier required:true", pid.required === true);
  check("payment_identifier behavior idempotent", pid.behavior === "idempotent");

  check("normalizeIdentifier lowercases/trims", normalizeIdentifier("  ABC ") === "abc");
  const seen = new Set();
  const first = paymentIdentityDecision("idem-1", seen);
  check("first identifier ok, not duplicate", first.ok === true && first.duplicate === false);
  seen.add(first.key);
  const second = paymentIdentityDecision("IDEM-1", seen);
  check("repeat identifier flagged duplicate (case-insensitive)", second.ok === false && second.duplicate === true);
  const none = paymentIdentityDecision(null, seen);
  check("no identifier → ok, no dedupe", none.ok === true && none.key === null);

  // --- Auth-hints ---
  const ah = authHintsExtension().auth_hints.info;
  check("auth_hints names PAYMENT-SIGNATURE", ah.signature_header === "PAYMENT-SIGNATURE");
  check("auth_hints network is Base CAIP-2", ah.network === BASE_CAIP2);

  // --- Offer-and-receipt: signed + deterministic ---
  check("offer_receipt declares signed+deterministic", (() => {
    const i = offerReceiptExtension().offer_receipt.info;
    return i.signed === true && i.deterministic === true;
  })());

  const bodyA = buildReceiptBody({
    offerId: "of_fixed",
    product: { id: "lounge-loop-detect", priceUsd: 0.03 },
    terms: { resource: "https://secondeyesai.com/api/bar/services/loop-detect", amountMicros: 30000 },
    paymentId: "pay-1",
  });
  const bodyB = buildReceiptBody({
    offerId: "of_fixed",
    product: { id: "lounge-loop-detect", priceUsd: 0.03 },
    terms: { resource: "https://secondeyesai.com/api/bar/services/loop-detect", amountMicros: 30000 },
    paymentId: "pay-1",
  });
  check("canonicalJson deterministic for equal bodies", canonicalJson(bodyA) === canonicalJson(bodyB));
  check("canonicalJson sorts keys", canonicalJson({ b: 1, a: 2 }) === '{"a":2,"b":1}');

  const signed = await signReceipt(bodyA, ENV);
  check("receipt is signed", signed.signed === true && typeof signed.signature === "string" && signed.signature.length === 64);
  const signed2 = await signReceipt(bodyB, ENV);
  check("deterministic signature for equal terms", signed.signature === signed2.signature);

  const verified = await verifyReceipt(signed, ENV);
  check("signed receipt verifies", verified.ok === true);

  const tampered = { ...signed, terms: { ...signed.terms, amountMicros: "99999" } };
  const verifyTampered = await verifyReceipt(tampered, ENV);
  check("tampered receipt fails verification", verifyTampered.ok === false);

  const noSecret = await verifyReceipt(signed, {});
  check("verify without secret → not ok", noSecret.ok === false);

  // --- Batch-settlement ---
  const bse = batchSettlementExtension().batch_settlement.info;
  check("batch_settlement supported but live=false", bse.supported === true && bse.live === false);
  check("batch_settlement has blocked_reason", typeof bse.blocked_reason === "string" && bse.blocked_reason.length > 0);

  let commit = openBatchCommitment({ payer: "0xabc", maxTotalMicros: 50000 });
  check("commitment opens with status open", commit.status === "open" && commit.accruedMicros === "0");
  const a1 = accrueToCommitment(commit, { amountMicros: 30000, ref: "loop-detect" });
  check("accrue under cap ok", a1.ok === true && a1.commitment.accruedMicros === "30000");
  const a2 = accrueToCommitment(a1.commitment, { amountMicros: 30000 });
  check("accrue over cap rejected", a2.ok === false && a2.error === "commitment_cap_exceeded");
  const closed = closeBatchCommitment(a1.commitment);
  check("close yields redeemable total, live_redemption false", closed.ok === true && closed.redeemableMicros === "30000" && closed.live_redemption === false);

  // --- Auth-capture ---
  const ace = authCaptureExtension().auth_capture.info;
  check("auth_capture supported but live=false", ace.supported === true && ace.live === false);
  check("auth_capture lists 4 operations", ace.operations.length === 4);

  const hold = authorizeMax({ payer: "0xabc", maxAmountMicros: 50000 });
  check("authorize creates hold", hold.status === "authorized" && hold.maxAmountMicros === "50000");
  const cap = captureActual(hold, 30000);
  check("capture ≤ max ok", cap.ok === true && cap.hold.capturedMicros === "30000" && cap.hold.status === "captured");
  const overCap = captureActual(hold, 99999);
  check("capture > max rejected", overCap.ok === false && overCap.error === "capture_exceeds_authorization");
  const voided = voidAuthorization(hold);
  check("void releases hold", voided.ok === true && voided.hold.status === "voided");

  // --- EIP-2612 sponsorship ---
  const sponsor = eip2612SponsorshipExtension().eip2612_sponsorship.info;
  check("eip2612 supported but live=false", sponsor.supported === true && sponsor.live === false);
  const permit = buildPermitTypedData({ owner: "0xowner", spender: "0xspender", value: 30000, nonce: 0, deadline: 9999999999 });
  check("permit typed-data has EIP-2612 domain", permit.domain.name === "USD Coin" && permit.domain.chainId === 8453);
  check("permit primaryType Permit", permit.primaryType === "Permit" && Array.isArray(permit.types.Permit));

  // --- Aggregate ---
  const all = allExtensions({ kind: "lounge", slug: "loop-detect" });
  for (const key of [
    "bazaar_metadata",
    "payment_identifier",
    "auth_hints",
    "offer_receipt",
    "batch_settlement",
    "auth_capture",
    "eip2612_sponsorship",
  ]) {
    check(`allExtensions includes ${key}`, key in all);
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll x402-extensions checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
