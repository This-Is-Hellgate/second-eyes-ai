import { makeId, nowIso } from "./review.js";

const TASK_TTL_SECONDS = 600;

// Lazily add product_kind/product_slug to access_grants when the D1 migration
// (seeds/grant-product-metadata.sql) has not been applied yet. ALTER ADD COLUMN
// is not idempotent, so we gate on pragma_table_info. Cached per worker instance.
let grantMetaColsReady = false;
async function ensureGrantProductColumns(env) {
  if (grantMetaColsReady || !env?.DB) return grantMetaColsReady;
  try {
    const cols = await env.DB.prepare(
      `SELECT name FROM pragma_table_info('access_grants') WHERE name IN ('product_kind','product_slug')`
    ).all();
    const have = new Set((cols.results || []).map((r) => r.name));
    if (!have.has("product_kind")) {
      await env.DB.prepare(`ALTER TABLE access_grants ADD COLUMN product_kind TEXT`).run();
    }
    if (!have.has("product_slug")) {
      await env.DB.prepare(`ALTER TABLE access_grants ADD COLUMN product_slug TEXT`).run();
    }
    grantMetaColsReady = true;
  } catch (err) {
    console.log(JSON.stringify({ grant_product_cols_error: String(err?.message || err).slice(0, 200) }));
  }
  return grantMetaColsReady;
}

export async function createA4ATask(env, { id, planId, requirements }) {
  const ts = nowIso();
  const expires = new Date(Date.now() + TASK_TTL_SECONDS * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO a4a_tasks
      (id, plan_id, status, requirements_json, created_at, updated_at, expires_at)
     VALUES (?, ?, 'payment-required', ?, ?, ?, ?)`
  )
    .bind(id, planId, JSON.stringify(requirements), ts, ts, expires)
    .run();

  return { id, planId, requirements, status: "payment-required", expiresAt: expires };
}

export async function getA4ATask(env, taskId) {
  const row = await env.DB.prepare(
    `SELECT id, plan_id, status, requirements_json, payment_payload_json,
            receipt_json, access_grant_id, error_text, created_at, updated_at, expires_at
     FROM a4a_tasks WHERE id = ?`
  )
    .bind(taskId)
    .first();

  if (!row) return null;

  if (row.expires_at && row.expires_at < nowIso() && row.status === "payment-required") {
    await updateA4ATask(env, taskId, { status: "expired", errorText: "Task expired" });
    return { ...parseTaskRow(row), status: "expired", expired: true };
  }

  return parseTaskRow(row);
}

export async function updateA4ATask(env, taskId, patch) {
  const ts = nowIso();
  const fields = ["updated_at = ?"];
  const values = [ts];

  if (patch.status) {
    fields.push("status = ?");
    values.push(patch.status);
  }
  if (patch.paymentPayloadJson !== undefined) {
    fields.push("payment_payload_json = ?");
    values.push(patch.paymentPayloadJson);
  }
  if (patch.receiptJson !== undefined) {
    fields.push("receipt_json = ?");
    values.push(patch.receiptJson);
  }
  if (patch.accessGrantId !== undefined) {
    fields.push("access_grant_id = ?");
    values.push(patch.accessGrantId);
  }
  if (patch.errorText !== undefined) {
    fields.push("error_text = ?");
    values.push(patch.errorText);
  }

  values.push(taskId);
  await env.DB.prepare(`UPDATE a4a_tasks SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function recordAccessGrant(env, grant) {
  if (!env.DB) {
    const id = grant.id || makeId("agr");
    return id;
  }

  if (grant.txRef) {
    const existing = await findAccessGrantByTxRef(env, grant.txRef);
    if (existing) return existing.id;
  }

  if (grant.stripeSessionId) {
    const existing = await findAccessGrantByStripeSession(env, grant.stripeSessionId);
    if (existing) return existing.id;
  }

  const id = grant.id || makeId("agr");
  const ts = nowIso();
  const hasProductCols = await ensureGrantProductColumns(env);

  try {
    if (hasProductCols) {
      await env.DB.prepare(
        `INSERT INTO access_grants
          (id, plan_id, rail, payer_ref, tx_ref, task_id, stripe_session_id, created_at, expires_at, bazaar_status, bazaar_reason, product_kind, product_slug)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          grant.planId,
          grant.rail,
          grant.payerRef || null,
          grant.txRef || null,
          grant.taskId || null,
          grant.stripeSessionId || null,
          ts,
          grant.expiresAt || null,
          grant.bazaarStatus || null,
          grant.bazaarReason || null,
          grant.productKind || null,
          grant.productSlug || null
        )
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO access_grants
          (id, plan_id, rail, payer_ref, tx_ref, task_id, stripe_session_id, created_at, expires_at, bazaar_status, bazaar_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          id,
          grant.planId,
          grant.rail,
          grant.payerRef || null,
          grant.txRef || null,
          grant.taskId || null,
          grant.stripeSessionId || null,
          ts,
          grant.expiresAt || null,
          grant.bazaarStatus || null,
          grant.bazaarReason || null
        )
        .run();
    }
  } catch (err) {
    if (grant.txRef) {
      const existing = await findAccessGrantByTxRef(env, grant.txRef);
      if (existing) return existing.id;
    }
    if (grant.stripeSessionId) {
      const existing = await findAccessGrantByStripeSession(env, grant.stripeSessionId);
      if (existing) return existing.id;
    }
    throw err;
  }

  return id;
}

export async function findAccessGrantByTxRef(env, txRef) {
  if (!env.DB || !txRef) return null;
  return env.DB.prepare(
    `SELECT id, plan_id, rail, payer_ref, tx_ref, stripe_session_id, created_at, expires_at
     FROM access_grants WHERE tx_ref = ? LIMIT 1`
  )
    .bind(txRef)
    .first();
}

export async function findAccessGrantByStripeSession(env, sessionId) {
  if (!env.DB || !sessionId) return null;
  return env.DB.prepare(
    `SELECT id, plan_id, rail, payer_ref, tx_ref, stripe_session_id, created_at, expires_at
     FROM access_grants WHERE stripe_session_id = ? LIMIT 1`
  )
    .bind(sessionId)
    .first();
}

export async function findIdempotencyGrant(env, key) {
  if (!env.DB || !key) return null;
  const row = await env.DB.prepare(
    `SELECT grant_id, product_kind, product_slug FROM idempotency_keys
     WHERE key = ? AND expires_at > ? LIMIT 1`
  )
    .bind(key, nowIso())
    .first();
  return row || null;
}

export async function storeIdempotencyKey(env, { key, grantId, productKind, productSlug, ttlSeconds = 86400 }) {
  if (!env.DB || !key) return;
  const ts = nowIso();
  const expires = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO idempotency_keys
      (key, grant_id, product_kind, product_slug, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(key, grantId, productKind || null, productSlug || null, ts, expires)
    .run();
}

export function readIdempotencyKey(request) {
  return (
    request.headers.get("Idempotency-Key") ||
    request.headers.get("X-Idempotency-Key") ||
    ""
  ).slice(0, 128);
}

function parseTaskRow(row) {
  return {
    id: row.id,
    planId: row.plan_id,
    status: row.status,
    requirements: safeJson(row.requirements_json),
    paymentPayload: safeJson(row.payment_payload_json),
    receipt: safeJson(row.receipt_json),
    accessGrantId: row.access_grant_id,
    errorText: row.error_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

function safeJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export { TASK_TTL_SECONDS };
