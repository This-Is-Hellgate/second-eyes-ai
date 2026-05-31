/**
 * Structured x402 payment attempt logging — one record per inbound payment header.
 *
 * Schema (JSON + D1 x402_payment_attempts):
 *   { timestamp, wallet, x402_version, route, verify_result, settle_result, failure_reason }
 *
 * verify_result / settle_result: "ok" | "fail" | "skipped"
 * failure_reason: null on full success; otherwise stable machine string
 */

import { makeId, nowIso } from "./review.js";
import { parsePaymentPayloadFromHeader } from "./x402.js";

/**
 * @param {object} env
 * @param {string} paymentHeader
 * @param {{ route?: string }} meta
 * @param {{ ok: boolean, error?: string, invalidReason?: string, stage?: string, receipt?: { payer?: string } }} verifyResult
 * @param {{ ok: boolean, error?: string, stage?: string, receipt?: { payer?: string } } | null} settleResult
 */
export async function recordX402PaymentAttempt(env, paymentHeader, meta, verifyResult, settleResult) {
  const payload = parsePaymentPayloadFromHeader(paymentHeader);
  const x402Version =
    payload?.x402Version ?? payload?.x402_version ?? payload?.accepted?.x402Version ?? 2;

  const verifyOk = Boolean(verifyResult?.ok);
  const settleOk = Boolean(settleResult?.ok);

  let settleResultLabel = "skipped";
  if (verifyOk && settleResult != null) {
    settleResultLabel = settleOk ? "ok" : "fail";
  }

  const wallet =
    settleResult?.receipt?.payer ||
    verifyResult?.receipt?.payer ||
    payload?.payer ||
    payload?.accepted?.payer ||
    null;

  const failureReason =
    meta?.failure_reason ??
    (verifyOk
      ? settleResult == null
        ? null
        : settleOk
          ? null
          : String(
              settleResult?.error ||
                settleResult?.invalidReason ||
                settleResult?.stage ||
                "settle_failed"
            ).slice(0, 500)
      : String(
          verifyResult?.error ||
            verifyResult?.invalidReason ||
            verifyResult?.stage ||
            "verify_failed"
        ).slice(0, 500));

  const record = {
    timestamp: nowIso(),
    wallet: wallet ? String(wallet).slice(0, 66) : null,
    x402_version: Number(x402Version) || 2,
    route: meta?.route || null,
    verify_result: verifyOk ? "ok" : "fail",
    settle_result: settleResultLabel,
    failure_reason: failureReason,
  };

  console.log(JSON.stringify({ x402_payment_attempt: record }));

  if (!env?.DB) return record;

  try {
    await env.DB.prepare(
      `INSERT INTO x402_payment_attempts
        (id, created_at, route, wallet, x402_version, verify_result, settle_result, failure_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        makeId("x402log"),
        record.timestamp,
        record.route || "/unknown",
        record.wallet,
        record.x402_version,
        record.verify_result,
        record.settle_result,
        record.failure_reason
      )
      .run();
  } catch (err) {
    console.log(
      JSON.stringify({
        x402_payment_log_error: String(err?.message || err).slice(0, 200),
        hint: "Apply seeds/x402-payment-log.sql to D1 if table is missing",
      })
    );
  }

  return record;
}
