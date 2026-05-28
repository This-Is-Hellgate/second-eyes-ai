import { authorize, handleOptions } from "../../_lib/auth.js";
import {
  classifyUrl,
  json,
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

  const url = new URL(context.request.url);
  const status = url.searchParams.get("status") || "open";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

  const countResult = await context.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM review_queue WHERE status = ?"
  )
    .bind(status)
    .first();

  const rows = await context.env.DB.prepare(
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
      s.status AS source_status
    FROM review_queue r
    JOIN submitted_sources s ON s.id = r.source_id
    WHERE r.status = ?
    ORDER BY r.created_at ASC
    LIMIT ? OFFSET ?`
  )
    .bind(status, limit, offset)
    .all();

  const items = (rows.results || []).map((row) => {
    const tier = recommendTier(row.url, row.reason);
    return {
      id: row.id,
      sourceId: row.source_id,
      reason: row.reason,
      reasonLabel: reasonLabel(row.reason),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      humanNote: row.human_note,
      url: row.url,
      kind: classifyUrl(row.url),
      channel: row.channel,
      submittedBy: row.submitted_by,
      supplyLabel: supplyLabel(row.submitted_by, row.channel),
      submittedAt: row.submitted_at,
      sourceStatus: row.source_status,
      detail: parseDetail(row.detail_json),
      title: titleFromUrl(row.url),
      tier: tier.tier,
      tierLabel: tier.tierLabel,
    };
  });

  return json({
    total: countResult?.total ?? items.length,
    offset,
    limit,
    status,
    items,
  });
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
