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
let failureTableReady = false;

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

/**
 * Recoverable request identifier for a verify attempt. Prefers the Cloudflare
 * ray id (cf-ray) — the value that appears in the CF dashboard as the request id
 * (e.g. req_… / the ray of the edge request) — so a persisted failure row can be
 * cross-referenced even after the dashboard logs roll off. Falls back to a
 * generated id when no request/ray is available (e.g. internal callers, tests).
 */
export function readRequestId(request) {
  const ray = request?.headers?.get?.("cf-ray");
  if (ray) return String(ray).slice(0, 80);
  const cfId = request?.cf?.requestId || request?.headers?.get?.("x-request-id");
  if (cfId) return String(cfId).slice(0, 80);
  return makeId("req");
}

/** Idempotent D1 bootstrap for the verify-failure detail table — mirrors seeds/x402-verify-failures.sql. */
export async function ensureX402VerifyFailureTable(env) {
  if (failureTableReady || !env?.DB) return Boolean(env?.DB);
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS x402_verify_failures (
        id TEXT PRIMARY KEY,
        request_id TEXT,
        created_at TEXT NOT NULL,
        route TEXT,
        stage TEXT,
        declared_network TEXT,
        selected_network TEXT,
        facilitator_status INTEGER,
        invalid_reason TEXT,
        facilitator_body TEXT,
        x402_version INTEGER
      )`
    ),
    env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_x402_verify_failures_request ON x402_verify_failures(request_id)`
    ),
    env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_x402_verify_failures_created ON x402_verify_failures(created_at)`
    ),
    env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_x402_verify_failures_stage ON x402_verify_failures(stage)`
    ),
  ]);
  failureTableReady = true;
  return true;
}

/**
 * Pull the recoverable verify-failure detail out of a verify/settle result into a
 * flat, secret-free row. facilitatorResponse is ALREADY redacted by
 * redactFacilitatorBody() at the verify call site; this only serializes/bounds it.
 * Returns null for a successful result (nothing to persist).
 */
export function buildVerifyFailureRow(result, meta = {}) {
  if (!result || result.ok) return null;
  let facilitatorBody = null;
  if (result.facilitatorResponse != null) {
    try {
      facilitatorBody = JSON.stringify(result.facilitatorResponse).slice(0, 2000);
    } catch {
      facilitatorBody = null;
    }
  }
  return {
    request_id: meta.requestId || null,
    route: meta.route || null,
    stage: result.stage || null,
    declared_network: result.declaredNetwork || null,
    selected_network: result.network || result.accept?.network || null,
    facilitator_status:
      typeof result.facilitatorStatus === "number" ? result.facilitatorStatus : null,
    invalid_reason: result.invalidReason || result.error || null,
    facilitator_body: facilitatorBody,
    x402_version: Number(meta.x402_version) || null,
  };
}

/** Persist one verify-failure detail row (redacted). Best-effort; never throws into the verify path. */
export async function recordX402VerifyFailure(env, result, meta = {}) {
  const row = buildVerifyFailureRow(result, meta);
  if (!row) return null;

  console.log(JSON.stringify({ x402_verify_failure: row }));

  if (!env?.DB) return row;
  try {
    await ensureX402VerifyFailureTable(env);
    await env.DB.prepare(
      `INSERT INTO x402_verify_failures
        (id, request_id, created_at, route, stage, declared_network, selected_network,
         facilitator_status, invalid_reason, facilitator_body, x402_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        makeId("x402fail"),
        row.request_id,
        nowIso(),
        row.route,
        row.stage,
        row.declared_network,
        row.selected_network,
        row.facilitator_status,
        row.invalid_reason,
        row.facilitator_body,
        row.x402_version
      )
      .run();
  } catch (err) {
    console.log(
      JSON.stringify({
        x402_verify_failure_log_error: String(err?.message || err).slice(0, 200),
      })
    );
  }
  return row;
}

/**
 * Look up persisted verify-failure detail by Cloudflare request id (cf-ray).
 * Returns every matching row (a ray normally maps to one attempt). The stored
 * facilitator_body is already redacted, so this is safe behind operator auth.
 */
export async function lookupX402VerifyFailure(env, requestId, { limit = 20 } = {}) {
  if (!env?.DB) return { ok: false, reason: "no_db_binding", failures: [] };
  if (!requestId || typeof requestId !== "string" || !requestId.trim()) {
    return { ok: false, reason: "missing_request_id", failures: [] };
  }
  await ensureX402VerifyFailureTable(env);
  const capped = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const rows = await env.DB.prepare(
    `SELECT id, request_id, created_at, route, stage, declared_network, selected_network,
            facilitator_status, invalid_reason, facilitator_body, x402_version
     FROM x402_verify_failures
     WHERE request_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  )
    .bind(requestId.trim(), capped)
    .all();

  const failures = (rows.results || []).map((row) => {
    let facilitatorBody = null;
    if (row.facilitator_body) {
      try {
        facilitatorBody = JSON.parse(row.facilitator_body);
      } catch {
        facilitatorBody = row.facilitator_body;
      }
    }
    return {
      id: row.id,
      request_id: row.request_id,
      timestamp: row.created_at,
      route: row.route,
      stage: row.stage,
      declared_network: row.declared_network,
      selected_network: row.selected_network,
      facilitator_status: row.facilitator_status,
      invalid_reason: row.invalid_reason,
      facilitator_body: facilitatorBody,
      x402_version: row.x402_version,
    };
  });

  return { ok: true, request_id: requestId.trim(), count: failures.length, failures };
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

  // Persist recoverable, redacted detail for the FAILED stage (verify, or settle
  // when verify passed) keyed by request id — so a future failure can be
  // diagnosed from D1 alone, without Cloudflare dashboard historical logs.
  const failedResult = !verifyOk ? verifyResult : !settleOk && settleResult != null ? settleResult : null;
  if (failedResult) {
    await recordX402VerifyFailure(env, failedResult, {
      requestId: meta?.requestId || null,
      route: record.route,
      x402_version: record.x402_version,
    });
  }

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
