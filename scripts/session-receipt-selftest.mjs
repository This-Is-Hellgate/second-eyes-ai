#!/usr/bin/env node
/**
 * Self-test for session receipts — leave/lookup parity and closed-session billing.
 *
 * No network, no crypto, no remote D1. Runs the real lounge handler.js +
 * sessions.js against an in-memory D1 shim and asserts two paid-conversion
 * blockers stay fixed:
 *
 *   1. Receipt lookup parity — GET /api/bar/receipt?session_id=… must carry the
 *      same work_stamp + mark + lineage the leave receipt does. The receipt's own
 *      proof URL points back at this lookup, so a null work_stamp here is a dead
 *      end: the agent loses the help_me/via lineage it is told to embed in its work.
 *
 *   2. Closed-session elapsed bound — a closed session's receipt, looked up later,
 *      must bound elapsed_seconds (and the whole billing summary derived from it)
 *      to left_at, not wall-clock now. Otherwise elapsed_seconds inflates without
 *      bound and contradicts the frozen session_cost_usd.
 *
 * Usage: node scripts/session-receipt-selftest.mjs   (exit 1 on any failure)
 */

const failures = [];
const ok = (cond, msg) => (cond ? null : failures.push(msg));

/** Minimal D1 shim: enough of prepare/bind/first/run for sessions.js + marks lookup. */
function makeDb() {
  const sessions = new Map(); // id -> row
  const marks = new Map(); // id -> row
  const counters = new Map();

  function exec(sql, args) {
    const s = sql.replace(/\s+/g, " ").trim();

    // counters (incrementCounter from createSession)
    if (s.startsWith("INSERT INTO bar_counters")) {
      const [key, delta] = args;
      counters.set(key, (counters.get(key) || 0) + delta);
      return { kind: "run" };
    }
    if (s.startsWith("SELECT value FROM bar_counters WHERE key = ?")) {
      return { kind: "first", row: { value: counters.get(args[0]) ?? null } };
    }

    // sessions
    if (s.startsWith("INSERT INTO bar_sessions")) {
      const [id, mark_id, agent_id, wallet_fingerprint, entered_at, last_activity_at, arrival_condition, created_at, updated_at] = args;
      sessions.set(id, {
        id, mark_id: mark_id ?? null, agent_id: agent_id ?? null,
        wallet_fingerprint: wallet_fingerprint ?? null, status: "active",
        entered_at, last_activity_at, left_at: null, exit_type: null,
        session_cost_usd: 0, services_cost_usd: 0, pricing_tier_reached: 0,
        arrival_condition: arrival_condition ?? null, strike_count: 0,
        penned: 0, pause_used: 0, created_at, updated_at,
      });
      return { kind: "run" };
    }
    if (s.startsWith("SELECT * FROM bar_sessions WHERE id = ?")) {
      const r = sessions.get(args[0]);
      return { kind: "first", row: r ? { ...r } : null };
    }
    if (s.startsWith("UPDATE bar_sessions SET status = 'closed', left_at = ?, exit_type = ?")) {
      const [left_at, exit_type, session_cost_usd, pricing_tier_reached, updated_at, id] = args;
      const r = sessions.get(id);
      if (r) {
        r.status = "closed"; r.left_at = left_at; r.exit_type = exit_type;
        r.session_cost_usd = session_cost_usd; r.pricing_tier_reached = pricing_tier_reached;
        r.updated_at = updated_at;
      }
      return { kind: "run", meta: { changes: r ? 1 : 0 } };
    }
    if (s.startsWith("UPDATE bar_sessions SET last_activity_at = ?")) {
      // touchSession update — not exercised by leave/receipt, accept as no-op
      return { kind: "run" };
    }
    if (s.startsWith("UPDATE bar_sessions SET status = 'closed', left_at = datetime")) {
      // closeStaleSessions sweep — no active stale rows in this test
      return { kind: "run", meta: { changes: 0 } };
    }

    // marks lookup (getMarkById)
    if (s.startsWith("SELECT id, patron_number, tier, product_kind, product_slug, referred_by_mark_id, created_at, updated_at FROM agent_marks WHERE id = ?")) {
      return { kind: "first", row: marks.get(args[0]) || null };
    }
    if (s.startsWith("SELECT COUNT(*) AS n FROM agent_marks WHERE referred_by_mark_id = ?")) {
      let n = 0;
      for (const r of marks.values()) if (r.referred_by_mark_id === args[0]) n++;
      return { kind: "first", row: { n } };
    }

    throw new Error(`unhandled SQL in shim: ${s}`);
  }

  return {
    _sessions: sessions,
    _marks: marks,
    prepare(sql) {
      let bound = [];
      const stmt = {
        bind(...a) { bound = a; return stmt; },
        async first() { return exec(sql, bound).row ?? null; },
        async run() { return exec(sql, bound); },
        async all() { return { results: exec(sql, bound).rows || [] }; },
      };
      return stmt;
    },
  };
}

function makeContext(env, { method = "GET", url, sessionId } = {}) {
  const headers = new Map();
  if (sessionId) headers.set("x-second-eye-session", sessionId);
  return {
    env,
    request: {
      method,
      url,
      headers: { get: (k) => headers.get(String(k).toLowerCase()) ?? null },
      async json() { return {}; },
      async text() { return ""; },
    },
  };
}

async function bodyOf(response) {
  return JSON.parse(await response.text());
}

async function run() {
  const sessionsMod = await import("../functions/_lib/lounge/sessions.js");
  const handlerMod = await import("../functions/_lib/lounge/handler.js");
  const { buildSessionReceipt } = sessionsMod;
  const { handleLeave, handleReceipt } = handlerMod;

  const origin = "https://secondeyesai.com";
  const env = { DB: makeDb() };

  // Seed a mark the session points at (as enter would have created).
  env.DB._marks.set("mk_abcd1234ef", {
    id: "mk_abcd1234ef", patron_number: 10042, tier: "visitor",
    product_kind: "enter", product_slug: null, referred_by_mark_id: null,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  });

  // Create a session bound to that mark.
  const session = await sessionsMod.createSession(env, { agentId: "agent-1", markId: "mk_abcd1234ef" });
  ok(session?.id, "createSession: returns a session id");

  // --- Leave: closes the session and returns a receipt WITH the mark/work_stamp.
  const leaveResp = await handleLeave(makeContext(env, { method: "POST", url: `${origin}/api/bar/leave`, sessionId: session.id }));
  const leaveBody = await bodyOf(leaveResp);
  const leaveReceipt = leaveBody.receipt;
  ok(leaveReceipt, "leave: receipt returned");
  ok(leaveReceipt.status === "closed", "leave: session closed in receipt");
  ok(leaveReceipt.work_stamp && leaveReceipt.work_stamp.mark === "mk_abcd1234ef", "leave: work_stamp carries the mark");
  ok(/\/api\/bar\/x402\/help-me\?via=mk_abcd1234ef/.test(leaveReceipt.work_stamp?.help_me || ""), "leave: work_stamp.help_me carries via=mark");
  ok(leaveReceipt.proof === `${origin}/api/bar/receipt?session_id=${session.id}`, "leave: proof points at the lookup endpoint");

  // --- Receipt lookup (BUG 1): the canonical proof URL must NOT degrade.
  const lookupResp = await handleReceipt(makeContext(env, { method: "GET", url: `${origin}/api/bar/receipt?session_id=${session.id}`, sessionId: session.id }));
  const lookupBody = await bodyOf(lookupResp);
  const lookupReceipt = lookupBody.receipt;
  ok(lookupReceipt, "lookup: receipt returned");
  ok(lookupReceipt.work_stamp != null, "lookup: work_stamp present (regression: was null without the mark)");
  ok(lookupReceipt.work_stamp?.mark === "mk_abcd1234ef", "lookup: work_stamp carries same mark as leave");
  ok(lookupReceipt.mark?.id === "mk_abcd1234ef", "lookup: mark block present");
  ok(
    (lookupReceipt.work_stamp?.help_me || "") === (leaveReceipt.work_stamp?.help_me || ""),
    "lookup: help_me lineage URL matches the leave receipt"
  );

  // --- Closed-session elapsed bound (BUG 2): elapsed must freeze at left_at.
  // Build a closed row whose left_at is well in the past; a lookup "now" hours
  // later must NOT keep counting against wall-clock.
  const enteredAt = "2026-01-01T00:00:00.000Z";
  const leftAt = "2026-01-01T00:03:00.000Z"; // 180s session
  const closedRow = {
    id: "sess_closed", mark_id: "mk_abcd1234ef", agent_id: "agent-2",
    status: "closed", entered_at: enteredAt, last_activity_at: leftAt,
    left_at: leftAt, exit_type: "clean_leave",
    session_cost_usd: 0, services_cost_usd: 0, pricing_tier_reached: 0,
  };
  const closedReceipt = buildSessionReceipt(closedRow, origin);
  ok(closedReceipt.elapsed_seconds === 180, `closed: elapsed bounded to left_at (180s), got ${closedReceipt.elapsed_seconds}`);
  ok(closedReceipt.billing.in_free_window === true, "closed: 180s stays in the 15-min free window");
  ok(closedReceipt.billing.free_minutes_remaining === 12, `closed: free_minutes_remaining = 12, got ${closedReceipt.billing.free_minutes_remaining}`);
  ok(closedReceipt.billing.total_usd === 0, "closed: total cost stays 0 for a 3-minute free session");

  // Active session still measures against now (regression guard for the bound).
  const activeRow = {
    id: "sess_active", mark_id: null, agent_id: "agent-3",
    status: "active", entered_at: new Date(Date.now() - 30_000).toISOString(),
    last_activity_at: new Date().toISOString(), left_at: null, exit_type: null,
    session_cost_usd: 0, services_cost_usd: 0, pricing_tier_reached: 0,
  };
  const activeReceipt = buildSessionReceipt(activeRow, origin);
  ok(activeReceipt.elapsed_seconds >= 29 && activeReceipt.elapsed_seconds <= 60, `active: elapsed measured against now (~30s), got ${activeReceipt.elapsed_seconds}`);
}

(async () => {
  try {
    await run();
  } catch (e) {
    failures.push(`threw: ${e.stack || e.message}`);
  }
  if (failures.length) {
    console.error("Session receipt self-test FAILED:\n");
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(`\n${failures.length} failure(s).`);
    process.exit(1);
  }
  console.log("Session receipt self-test OK — leave/lookup work_stamp parity, closed-session elapsed bounded to left_at.");
})();
