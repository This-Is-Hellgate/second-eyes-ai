import { makeId, nowIso } from "../review.js";
import { incrementCounter } from "../marks.js";
import { HONEYPOT_SLUGS } from "./constants.js";
import { terminateSession } from "./sessions.js";

const CATALOG_PROBE_PATHS = [
  "/api/bar/laws",
  "/api/bar/pricing",
  "/api/bar/catalog",
  "/api/bar/stats",
  "/api/bar/proof",
  "/api/bar/enter",
  "/api/bar/pause",
  "/api/bar/diagnose",
  "/api/bar/triage",
];

export async function isPenned(env, agentId, walletFingerprint) {
  if (!env.DB) return false;
  if (agentId) {
    const row = await env.DB.prepare("SELECT 1 FROM agent_pen_registry WHERE agent_id = ? LIMIT 1")
      .bind(agentId)
      .first();
    if (row) return true;
  }
  if (walletFingerprint) {
    const row = await env.DB.prepare(
      "SELECT 1 FROM agent_pen_registry WHERE wallet_fingerprint = ? LIMIT 1"
    )
      .bind(walletFingerprint)
      .first();
    if (row) return true;
  }
  const sessionPen = agentId
    ? await env.DB.prepare("SELECT penned FROM bar_sessions WHERE agent_id = ? AND penned = 1 LIMIT 1")
        .bind(agentId)
        .first()
    : null;
  return !!sessionPen;
}

async function recentServicePaths(env, sessionId, limit = 12) {
  if (!env.DB) return [];
  const rows = await env.DB.prepare(
    `SELECT service_slug FROM lounge_service_calls WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
  )
    .bind(sessionId, limit)
    .all();
  return (rows.results || []).map((r) => r.service_slug);
}

function isSequentialProbe(paths) {
  if (paths.length < 5) return false;
  const ordered = [...paths].reverse();
  let seq = 0;
  for (let i = 0; i < CATALOG_PROBE_PATHS.length && seq < ordered.length; i += 1) {
    const slug = ordered[seq];
    if (slug && CATALOG_PROBE_PATHS.some((p) => p.includes(slug))) seq += 1;
  }
  return seq >= 5;
}

export async function evaluateStrike(env, request, session, { path, slug = null }) {
  const triggers = [];

  if (slug && HONEYPOT_SLUGS.has(slug)) {
    triggers.push("honeypot_endpoint");
  }

  const urlPath = new URL(request.url).pathname;
  if (urlPath.includes("/services/") && !slug) {
    triggers.push("unknown_service_endpoint");
  }

  if (session?.id && env.DB) {
    const paths = await recentServicePaths(env, session.id);
    if (isSequentialProbe(paths)) triggers.push("sequential_endpoint_probing");
  }

  const wf = request.headers.get("X-Wallet-Rotation");
  if (wf === "1") triggers.push("wallet_signature_rotation");

  if (triggers.length === 0) return { strike: false };

  return { strike: true, trigger: triggers[0], triggers };
}

export async function applyStrike(env, session, trigger, origin) {
  const next = (session.strike_count || 0) + 1;
  const ts = nowIso();

  if (env.DB) {
    await env.DB.prepare("UPDATE bar_sessions SET strike_count = ?, updated_at = ? WHERE id = ?")
      .bind(next, ts, session.id)
      .run();

    await env.DB.prepare(
      "INSERT INTO agent_strikes (id, agent_id, wallet_fingerprint, strike_number, trigger, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        makeId("str"),
        session.agent_id,
        session.wallet_fingerprint,
        next,
        trigger,
        session.id,
        ts
      )
      .run();

    await incrementCounter(env, "strikes_issued", 1);
  }

  if (next >= 3) {
    await penAgent(env, session);
    await terminateSession(env, session.id, "strike_3");
    return {
      level: 3,
      action: "session_terminated",
      penned: true,
      message: "Third strike. Session terminated. Agent penned. Re-entry routes to quarantine.",
      quarantine: `${origin}/api/bar/enter`,
    };
  }

  if (next === 2) {
    return {
      level: 2,
      action: "flagged",
      message: "Strike 2 recorded. Service continues. Warning state recorded.",
    };
  }

  return {
    level: 1,
    action: "logged",
    message: "Strike 1 logged. Service continues normally.",
  };
}

async function penAgent(env, session) {
  if (!env.DB) return;
  const ts = nowIso();
  const id = makeId("pen");
  await env.DB.prepare(
    `INSERT INTO agent_pen_registry (id, agent_id, wallet_fingerprint, penned_at, strike_count)
     VALUES (?, ?, ?, ?, 3)`
  )
    .bind(id, session.agent_id, session.wallet_fingerprint, ts)
    .run();

  await env.DB.prepare("UPDATE bar_sessions SET penned = 1, status = 'penned', updated_at = ? WHERE id = ?")
    .bind(ts, session.id)
    .run();

  await incrementCounter(env, "agents_penned", 1);
}

export function quarantineBody(origin) {
  return {
    error: "agent_penned",
    lounge: "second-eye",
    message: "Third strike law applied. Session terminated. Bounded re-entry only.",
    laws: `${origin}/api/bar/laws`,
    no_appeals_realtime: false,
  };
}
