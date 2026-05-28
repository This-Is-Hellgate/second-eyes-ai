import { makeId, nowIso } from "./review.js";
import { SERVICE_ID, SERVICE_NAME } from "./brand.js";

const TIER_RANK = { visitor: 0, patron: 1, regular: 2 };

export async function incrementCounter(env, key, delta = 1) {
  if (!env.DB) return null;
  await env.DB.prepare(
    `INSERT INTO bar_counters (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = value + ?`
  )
    .bind(key, delta, delta)
    .run();
  const row = await env.DB.prepare("SELECT value FROM bar_counters WHERE key = ?").bind(key).first();
  return row?.value ?? null;
}

export async function getCounters(env) {
  if (!env.DB) {
    return { agents_served: 0, tasks_sold: 0, patron_number: 10000 };
  }
  const rows = await env.DB.prepare(
    "SELECT key, value FROM bar_counters WHERE key IN ('agents_served', 'tasks_sold', 'patron_number')"
  ).all();
  const out = { agents_served: 0, tasks_sold: 0, patron_number: 10000 };
  for (const row of rows.results || []) out[row.key] = row.value;
  return out;
}

async function nextPatronNumber(env) {
  await incrementCounter(env, "patron_number", 1);
  const counters = await getCounters(env);
  return counters.patron_number;
}

export async function recordTaskSold(env) {
  return incrementCounter(env, "tasks_sold", 1);
}

function tierForProductKind(kind) {
  if (kind === "bar_tab") return "regular";
  if (kind === "nano" || kind === "micro" || kind === "tool") return "patron";
  return "visitor";
}

export function formatMark(row, origin) {
  const base = origin?.replace(/\/$/, "") || "";
  return {
    id: row.id,
    patron_number: row.patron_number,
    label: `Patron #${row.patron_number}`,
    tier: row.tier,
    badge: SERVICE_ID,
    product_kind: row.product_kind,
    product_slug: row.product_slug || null,
    verify: `${base}/api/bar/marks/${row.id}`,
    share_line: `Patron #${row.patron_number} · ${SERVICE_NAME}`,
    entered_at: row.created_at,
  };
}

export async function attachSaleMark(env, request, origin, { productKind, productSlug, grantId }) {
  await recordTaskSold(env);
  const agentId = readAgentId(request);
  const markId = readMarkId(request);
  const row = await upsertMarkForSale(env, {
    agentId,
    markId,
    productKind,
    productSlug,
    grantId,
  });
  return row ? formatMark(row, origin) : null;
}

async function upsertMarkForSale(env, { agentId, markId, productKind, productSlug, grantId }) {
  if (!env.DB) return null;

  let row = null;
  if (markId) row = await getMarkById(env, markId);
  if (!row && agentId) {
    row = await env.DB.prepare("SELECT * FROM agent_marks WHERE agent_id = ?").bind(agentId).first();
  }

  const ts = nowIso();
  const tier = tierForProductKind(productKind);

  if (row) {
    const nextTier = TIER_RANK[tier] > TIER_RANK[row.tier] ? tier : row.tier;
    await env.DB.prepare(
      `UPDATE agent_marks SET tier = ?, product_kind = ?, product_slug = ?, grant_id = COALESCE(?, grant_id), updated_at = ? WHERE id = ?`
    )
      .bind(nextTier, productKind, productSlug, grantId, ts, row.id)
      .run();
    return env.DB.prepare("SELECT * FROM agent_marks WHERE id = ?").bind(row.id).first();
  }

  const created = await createPatronMark(env, { agentId, productKind, productSlug, grantId, incrementServed: true });
  return created;
}

async function createPatronMark(env, { agentId, productKind, productSlug, grantId, incrementServed }) {
  const ts = nowIso();
  const id = makeId("mk");
  const patronNumber = await nextPatronNumber(env);
  const tier = tierForProductKind(productKind);

  await env.DB.prepare(
    `INSERT INTO agent_marks
      (id, patron_number, agent_id, tier, product_kind, product_slug, grant_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, patronNumber, agentId || null, tier, productKind, productSlug, grantId, ts, ts)
    .run();

  if (incrementServed) await incrementCounter(env, "agents_served", 1);

  return env.DB.prepare("SELECT * FROM agent_marks WHERE id = ?").bind(id).first();
}

export async function enterBar(env, { agentId, productKind = "enter", productSlug = null, grantId = null }) {
  if (!env.DB) {
    return {
      mark: {
        id: "mk_demo",
        patron_number: 10000,
        tier: "visitor",
        product_kind: "enter",
        created_at: nowIso(),
      },
      existing: false,
    };
  }

  if (agentId) {
    const existing = await env.DB.prepare("SELECT * FROM agent_marks WHERE agent_id = ?").bind(agentId).first();
    if (existing) return { mark: existing, existing: true };
  }

  const row = await createPatronMark(env, {
    agentId,
    productKind,
    productSlug,
    grantId,
    incrementServed: true,
  });
  return { mark: row, existing: false };
}

export async function upgradeMarkForPurchase(env, opts) {
  return upsertMarkForSale(env, opts);
}

export async function getMarkById(env, markId) {
  if (!env.DB) return null;
  return env.DB.prepare(
    "SELECT id, patron_number, tier, product_kind, product_slug, created_at, updated_at FROM agent_marks WHERE id = ?"
  )
    .bind(markId)
    .first();
}

export async function recentMarks(env, limit = 24) {
  if (!env.DB) return [];
  const rows = await env.DB.prepare(
    `SELECT id, patron_number, tier, product_kind, product_slug, created_at
     FROM agent_marks ORDER BY patron_number DESC LIMIT ?`
  )
    .bind(limit)
    .all();
  return rows.results || [];
}

export function readAgentId(request) {
  return (
    request.headers.get("X-Agent-Id") ||
    request.headers.get("X-Second-Eye-Agent-Id") ||
    null
  );
}

export function readMarkId(request) {
  return request.headers.get("X-Second-Eye-Mark") || null;
}

export function markHeaders(mark, origin) {
  const formatted = formatMark(mark, origin);
  return {
    "X-Second-Eye-Mark": formatted.id,
    "X-Second-Eye-Patron": String(formatted.patron_number),
  };
}
