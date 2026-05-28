import { authorize, handleOptions } from "../../_lib/auth.js";
import {
  classifyUrl,
  json,
  makeId,
  nowIso,
  parseDetail,
  reasonLabel,
  recommendTier,
  supplyLabel,
} from "../../_lib/review.js";

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestGet(context) {
  const auth = authorize(context.request, context.env);
  if (!auth.ok) return auth.response;

  const id = context.params.id;
  const row = await context.env.DB.prepare(
    `SELECT
      r.id,
      r.source_id,
      r.reason,
      r.status,
      r.detail_json,
      r.created_at,
      r.updated_at,
      r.human_note,
      s.url,
      s.channel,
      s.submitted_by,
      s.submitted_at,
      s.status AS source_status,
      s.raw_ref
    FROM review_queue r
    JOIN submitted_sources s ON s.id = r.source_id
    WHERE r.id = ?`
  )
    .bind(id)
    .first();

  if (!row) return json({ error: "Not found" }, 404);

  let signal = null;
  if (row.url) {
    signal = await context.env.DB.prepare(
      `SELECT id, raw_text, metadata, payload, notes, source, status
       FROM signals
       WHERE source_url = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    )
      .bind(row.url)
      .first();
  }

  const tier = recommendTier(row.url, row.reason);

  return json({
    id: row.id,
    sourceId: row.source_id,
    reason: row.reason,
    reasonLabel: reasonLabel(row.reason),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    humanNote: row.human_note,
    url: row.url,
    title: titleFromUrl(row.url),
    kind: classifyUrl(row.url),
    channel: row.channel,
    submittedBy: row.submitted_by,
    supplyLabel: supplyLabel(row.submitted_by, row.channel),
    submittedAt: row.submitted_at,
    sourceStatus: row.source_status,
    rawRef: row.raw_ref,
    tier: tier.tier,
    tierLabel: tier.tierLabel,
    detail: parseDetail(row.detail_json),
    signal: signal
      ? {
          id: signal.id,
          rawText: signal.raw_text,
          metadata: safeJson(signal.metadata),
          payload: safeJson(signal.payload),
          notes: signal.notes,
          source: signal.source,
          status: signal.status,
        }
      : null,
  });
}

export async function onRequestPost(context) {
  const auth = authorize(context.request, context.env);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = body.action;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";

  if (!["approve", "deny"].includes(action)) {
    return json({ error: "action must be approve or deny" }, 400);
  }

  const id = context.params.id;
  const existing = await context.env.DB.prepare(
    "SELECT id, source_id, status, reason FROM review_queue WHERE id = ?"
  )
    .bind(id)
    .first();

  if (!existing) return json({ error: "Not found" }, 404);
  if (existing.status !== "open") {
    return json({ error: `Item already ${existing.status}` }, 409);
  }

  const ts = nowIso();
  const reviewStatus = action === "approve" ? "approved" : "denied";
  const sourceStatus = action === "approve" ? "approved" : "rejected";
  const decision = action === "approve" ? "allow" : "deny";
  const feedbackType = action === "approve" ? "approve" : "reject";

  const feedbackId = makeId("fb");
  const receiptId = makeId("vr");

  const statements = [
    context.env.DB.prepare(
      "UPDATE review_queue SET status = ?, human_note = ?, updated_at = ? WHERE id = ? AND status = 'open'"
    ).bind(reviewStatus, note, ts, id),
    context.env.DB.prepare(
      "UPDATE submitted_sources SET status = ? WHERE id = ?"
    ).bind(sourceStatus, existing.source_id),
    context.env.DB.prepare(
      `INSERT INTO human_feedback (id, target_id, feedback_type, note, channel, created_at)
       VALUES (?, ?, ?, ?, 'review_ui', ?)`
    ).bind(feedbackId, id, feedbackType, note, ts),
    context.env.DB.prepare(
      `INSERT INTO validator_receipts (id, source_id, receipt_type, decision, reason, checks_json, created_at)
       VALUES (?, ?, 'human_review', ?, ?, ?, ?)`
    ).bind(
      receiptId,
      existing.source_id,
      decision,
      note || existing.reason,
      JSON.stringify({ reviewQueueId: id, action, channel: "review_ui" }),
      ts
    ),
  ];

  const results = await context.env.DB.batch(statements);
  const updated = results[0]?.meta?.changes ?? 0;
  if (!updated) return json({ error: "Could not update item" }, 409);

  return json({
    ok: true,
    id,
    status: reviewStatus,
    sourceStatus,
    feedbackId,
    receiptId,
    updatedAt: ts,
  });
}

function safeJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("github.com")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    }
    if (parsed.hostname.includes("huggingface.co")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    }
    return parsed.hostname + parsed.pathname.slice(0, 80);
  } catch {
    return url.slice(0, 80);
  }
}
