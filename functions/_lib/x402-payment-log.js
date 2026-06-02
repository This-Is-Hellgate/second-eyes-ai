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
 * Compact, queryable failure string for the D1 failure_reason column. Folds the
 * CDP diagnostic fields (stage, invalidReason, facilitatorStatus, declared rail)
 * into one bounded string so the payment-attempts audit trail explains WHY a
 * verify failed — without adding columns (the runtime D1 bootstrap is
 * CREATE TABLE IF NOT EXISTS only, so a new column would need a real migration).
 */
export function composeFailureReason(result, fallback) {
  if (!result) return fallback;
  const base =
    result.error || result.invalidReason || result.stage || fallback;
  const tags = [];
  if (result.stage && result.stage !== base) tags.push(`stage=${result.stage}`);
  if (result.invalidReason && result.invalidReason !== base) {
    tags.push(`invalidReason=${result.invalidReason}`);
  }
  if (result.facilitatorStatus) tags.push(`status=${result.facilitatorStatus}`);
  if (result.declaredNetwork) tags.push(`network=${result.declaredNetwork}`);
  const composed = tags.length ? `${base} (${tags.join(" ")})` : String(base);
  return composed.slice(0, 500);
}

/** Public-safe wallet display: first 6 + last 4 chars. */
export function truncateWallet(wallet) {
  if (!wallet) return null;
  const w = String(wallet);
  if (w.length <= 12) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

/**
 * Parse since filter: ISO timestamp, or relative e.g. 24h, 7d.
 * @returns {string | null} ISO lower bound
 */
export function parseSinceFilter(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const rel = /^(\d+)(h|d)$/i.exec(trimmed);
  if (rel) {
    const n = Number(rel[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = rel[2].toLowerCase() === "d" ? n * 86_400_000 : n * 3_600_000;
    return new Date(Date.now() - ms).toISOString();
  }
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return null;
}

/**
 * Recent payment attempts for the public proof dashboard.
 * @param {object} env
 * @param {{ limit?: number, since?: string | null }} opts
 */
export async function listX402PaymentAttempts(env, { limit = 50, since = null } = {}) {
  if (!env?.DB) {
    return { ok: false, reason: "no_db_binding", attempts: [], summary: {} };
  }
  await ensureX402PaymentLogTable(env);

  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  let rows;
  if (since) {
    rows = await env.DB.prepare(
      `SELECT id, created_at, route, wallet, x402_version, verify_result, settle_result, failure_reason
       FROM x402_payment_attempts
       WHERE created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
      .bind(since, capped)
      .all();
  } else {
    rows = await env.DB.prepare(
      `SELECT id, created_at, route, wallet, x402_version, verify_result, settle_result, failure_reason
       FROM x402_payment_attempts
       ORDER BY created_at DESC
       LIMIT ?`
    )
      .bind(capped)
      .all();
  }

  const attempts = (rows.results || []).map((row) => ({
    id: row.id,
    timestamp: row.created_at,
    route: row.route,
    wallet: truncateWallet(row.wallet),
    x402_version: row.x402_version,
    verify_result: row.verify_result,
    settle_result: row.settle_result,
    failure_reason: row.failure_reason,
  }));

  const summary = {
    returned: attempts.length,
    verify_ok: attempts.filter((a) => a.verify_result === "ok").length,
    verify_fail: attempts.filter((a) => a.verify_result === "fail").length,
    settle_ok: attempts.filter((a) => a.settle_result === "ok").length,
    settle_fail: attempts.filter((a) => a.settle_result === "fail").length,
    settle_skipped: attempts.filter((a) => a.settle_result === "skipped").length,
  };

  return { ok: true, attempts, summary };
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
          : composeFailureReason(settleResult, "settle_failed")
      : composeFailureReason(verifyResult, "verify_failed"));

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
