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

let tableReady = false;

/** Idempotent D1 bootstrap — mirrors seeds/x402-payment-log.sql for when wrangler migrate cannot run. */
export async function ensureX402PaymentLogTable(env) {
  if (tableReady || !env?.DB) return Boolean(env?.DB);
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS x402_payment_attempts (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        route TEXT NOT NULL,
        wallet TEXT,
        x402_version INTEGER,
        verify_result TEXT NOT NULL,
        settle_result TEXT NOT NULL,
        failure_reason TEXT
      )`
    ),
    env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_x402_payment_attempts_created ON x402_payment_attempts(created_at)`
    ),
    env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_x402_payment_attempts_wallet ON x402_payment_attempts(wallet)`
    ),
    env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_x402_payment_attempts_route ON x402_payment_attempts(route)`
    ),
  ]);
  tableReady = true;
  return true;
}

/** Verify table exists (runs ensure first). */
export async function checkX402PaymentLogTable(env) {
  if (!env?.DB) return { exists: false, reason: "no_db_binding" };
  await ensureX402PaymentLogTable(env);
  const row = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='x402_payment_attempts'`
  ).first();
  return { exists: Boolean(row?.name), table: row?.name || null };
}

/**
 * @param {object} env
 * @param {string} paymentHeader
 * @param {{ route?: string, failure_reason?: string }} meta
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
    await ensureX402PaymentLogTable(env);
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
      })
    );
  }

  return record;
}
