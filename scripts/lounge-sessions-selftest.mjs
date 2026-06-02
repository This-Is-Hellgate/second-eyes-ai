#!/usr/bin/env node
/**
 * No-spend proof of the stale-session closure policy (Codex C-012):
 * chooseStaleClosure() must close a session at the EARLIER of the idle boundary
 * (last_activity_at + IDLE) and the max-TTL boundary (entered_at + MAX), and
 * label it with that boundary's exit_type — never let the later boundary win.
 *
 * The C-012 bug: an idle sweep that ran first could stamp idle_timeout with a
 * left_at past the real max-TTL boundary, inflating average_session_seconds
 * beyond MAX_SESSION_SECONDS. The shared chooseStaleClosure() is the single
 * source of truth for both touchSession() and the closeStaleSessions() sweep.
 *
 * Pure — no network, no money, repo modules + Node built-ins only. Exit 1 on
 * any failure.
 */

import { chooseStaleClosure, touchSession } from "../functions/_lib/lounge/sessions.js";
import { IDLE_TIMEOUT_SECONDS, MAX_SESSION_SECONDS } from "../functions/_lib/lounge/constants.js";

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
const eq = (where, got, want) => {
  if (got !== want) fail(where, `got ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
};

const IDLE_MS = IDLE_TIMEOUT_SECONDS * 1000;
const MAX_MS = MAX_SESSION_SECONDS * 1000;

// Build a session whose entered_at and last_activity_at are offsets (in ms)
// before a fixed `now`.
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
function session({ enteredAgoMs, lastActivityAgoMs }) {
  return {
    entered_at: new Date(NOW - enteredAgoMs).toISOString(),
    last_activity_at: new Date(NOW - lastActivityAgoMs).toISOString(),
  };
}

// --- 1. Neither boundary crossed → no closure ---
{
  const s = session({ enteredAgoMs: 60_000, lastActivityAgoMs: 10_000 });
  eq("neither", chooseStaleClosure(s, NOW), null);
}

// --- 2. Only idle crossed (session young, but quiet a long time) ---
{
  const lastAgo = IDLE_MS + 30_000; // well past idle
  const s = session({ enteredAgoMs: lastAgo + 5_000, lastActivityAgoMs: lastAgo });
  const c = chooseStaleClosure(s, NOW);
  eq("only-idle exit_type", c?.exit_type, "idle_timeout");
  const expected = new Date(s.last_activity_at).getTime() + IDLE_MS;
  eq("only-idle left_at bounded to idle boundary", c?.left_at_ms, expected);
}

// --- 3. Only max-TTL crossed (busy session that outran the ceiling) ---
//   entered long ago, but last_activity_at is recent (still active), so idle
//   boundary has NOT been crossed — only the max-TTL ceiling has.
{
  const s = session({ enteredAgoMs: MAX_MS + 60_000, lastActivityAgoMs: 5_000 });
  const c = chooseStaleClosure(s, NOW);
  eq("only-maxttl exit_type", c?.exit_type, "max_ttl");
  const expected = new Date(s.entered_at).getTime() + MAX_MS;
  eq("only-maxttl left_at bounded to max-ttl boundary", c?.left_at_ms, expected);
}

// --- 4. BOTH crossed, max-TTL boundary EARLIER → close as max_ttl ---
//   Abandoned long session: entered way past MAX, last activity also long ago.
//   max-TTL boundary (entered+MAX) lands before idle boundary (last+IDLE) when
//   the gap since last activity is short relative to total age.
{
  // entered 2*MAX ago, last activity MAX ago. idle boundary = NOW-MAX+IDLE.
  // max-ttl boundary = NOW-2*MAX+MAX = NOW-MAX. Earlier than idle boundary.
  const s = session({ enteredAgoMs: 2 * MAX_MS, lastActivityAgoMs: MAX_MS });
  const c = chooseStaleClosure(s, NOW);
  eq("both-maxttl-earlier exit_type", c?.exit_type, "max_ttl");
  const maxBoundary = new Date(s.entered_at).getTime() + MAX_MS;
  eq("both-maxttl-earlier left_at = max boundary", c?.left_at_ms, maxBoundary);
  // Guard the C-012 regression directly: left_at - entered must equal MAX, never more.
  eq(
    "both-maxttl-earlier elapsed == MAX (no inflation)",
    Math.round((c.left_at_ms - new Date(s.entered_at).getTime()) / 1000),
    MAX_SESSION_SECONDS
  );
}

// --- 5. BOTH crossed, idle boundary EARLIER → close as idle_timeout ---
//   Session that went quiet early in its life, then sat abandoned past MAX age.
//   last_activity_at right after entry → idle boundary (last+IDLE) is far
//   earlier than max-ttl boundary (entered+MAX).
{
  // entered 2*MAX ago, last activity 2*MAX - 1s ago (quiet almost immediately).
  const s = session({ enteredAgoMs: 2 * MAX_MS, lastActivityAgoMs: 2 * MAX_MS - 1_000 });
  const c = chooseStaleClosure(s, NOW);
  eq("both-idle-earlier exit_type", c?.exit_type, "idle_timeout");
  const idleBoundary = new Date(s.last_activity_at).getTime() + IDLE_MS;
  eq("both-idle-earlier left_at = idle boundary", c?.left_at_ms, idleBoundary);
}

// --- 6. Tie: both boundaries land on the same instant → max_ttl wins (hard ceiling) ---
//   idle boundary == max boundary  ⇔  last_activity_at + IDLE == entered_at + MAX
//   ⇔ last_activity_at = entered_at + (MAX - IDLE).
{
  const enteredAgoMs = 2 * MAX_MS; // safely past both boundaries
  const lastActivityAgoMs = enteredAgoMs - (MAX_MS - IDLE_MS);
  const s = session({ enteredAgoMs, lastActivityAgoMs });
  // Sanity: the two boundaries are equal for this construction.
  const idleBoundary = new Date(s.last_activity_at).getTime() + IDLE_MS;
  const maxBoundary = new Date(s.entered_at).getTime() + MAX_MS;
  eq("tie boundaries equal (test construction)", idleBoundary, maxBoundary);
  const c = chooseStaleClosure(s, NOW);
  eq("tie resolves to max_ttl", c?.exit_type, "max_ttl");
  eq("tie left_at = shared boundary", c?.left_at_ms, maxBoundary);
}

// --- 8. C-023: touchSession on a long-stale session closes at the policy
//   boundary, not wall-clock now. A minimal in-memory D1 stub holds one row;
//   touchSession looks it up, sees it is stale, and terminates it. The stored
//   left_at MUST equal the policy boundary (entered/last + window), so
//   left_at - entered_at == the window, never the (huge) gap to wall-clock now.
{
  // One abandoned session: entered 5*MAX ago, last activity 5*MAX ago too, so it
  // crossed both boundaries long before "now". Only "touched" now, hours later.
  const enteredMs = Date.now() - 5 * MAX_MS;
  const row = {
    id: "sess_stale",
    status: "active",
    agent_id: "agent_x",
    wallet_fingerprint: null,
    entered_at: new Date(enteredMs).toISOString(),
    last_activity_at: new Date(enteredMs).toISOString(),
    session_cost_usd: 0,
    pricing_tier_reached: 0,
  };

  // D1-shaped stub: prepare(sql).bind(...).first() / .run(). SELECT returns the
  // row; UPDATE mutates the stored row by parsing the SET assignments by position.
  const store = { sess_stale: { ...row } };
  const makeStmt = (sql) => ({
    _args: [],
    bind(...args) {
      this._args = args;
      return this;
    },
    async first() {
      return store.sess_stale ? { ...store.sess_stale } : null;
    },
    async run() {
      if (/UPDATE bar_sessions SET status = 'closed'/.test(sql)) {
        const [leftAt, exitType, cost, tier /* updated_at */] = this._args;
        const tgt = store.sess_stale;
        tgt.status = "closed";
        tgt.left_at = leftAt;
        tgt.exit_type = exitType;
        tgt.session_cost_usd = cost;
        tgt.pricing_tier_reached = tier;
      }
      return { meta: { changes: 1 } };
    },
  });
  const env = { DB: { prepare: (sql) => makeStmt(sql) } };

  const res = await touchSession(env, "sess_stale");
  eq("c023 touchSession not ok (stale)", res.ok, false);
  // entered==last and both far past now → max-TTL boundary (entered+MAX) is the
  // earlier one (idle boundary = last+IDLE = entered+IDLE < entered+MAX). Wait —
  // idle boundary is EARLIER here (IDLE < MAX), so this closes as idle_timeout.
  eq("c023 exit_type", res.error, "session_idle_timeout");

  const stored = store.sess_stale;
  const idleBoundaryMs = new Date(row.last_activity_at).getTime() + IDLE_MS;
  eq("c023 left_at bounded to idle boundary, not now", stored.left_at, new Date(idleBoundaryMs).toISOString());

  // The C-023 regression guard: elapsed (left_at - entered_at) must be the idle
  // window, NOT the ~5*MAX gap to wall-clock now.
  const elapsedSec = Math.round((new Date(stored.left_at).getTime() - enteredMs) / 1000);
  eq("c023 elapsed == idle window (no wall-clock inflation)", elapsedSec, IDLE_TIMEOUT_SECONDS);
  eq("c023 returned session.left_at matches stored", res.session.left_at, stored.left_at);
  eq("c023 returned elapsed_seconds bounded", res.session.elapsed_seconds, IDLE_TIMEOUT_SECONDS);
}

// --- 8b. C-023: a busy-but-aged session (recent activity, entered past MAX)
//   closes at the max-TTL boundary, and elapsed == MAX, not the gap to now. ---
{
  const enteredMs = Date.now() - 3 * MAX_MS;
  const lastMs = Date.now() - 1_000; // active 1s ago → idle NOT crossed
  const store = {
    s: {
      id: "s",
      status: "active",
      agent_id: "a",
      wallet_fingerprint: null,
      entered_at: new Date(enteredMs).toISOString(),
      last_activity_at: new Date(lastMs).toISOString(),
      session_cost_usd: 0,
      pricing_tier_reached: 0,
    },
  };
  const makeStmt = (sql) => ({
    _args: [],
    bind(...args) {
      this._args = args;
      return this;
    },
    async first() {
      return store.s ? { ...store.s } : null;
    },
    async run() {
      if (/UPDATE bar_sessions SET status = 'closed'/.test(sql)) {
        const [leftAt, exitType, cost, tier] = this._args;
        Object.assign(store.s, {
          status: "closed",
          left_at: leftAt,
          exit_type: exitType,
          session_cost_usd: cost,
          pricing_tier_reached: tier,
        });
      }
      return { meta: { changes: 1 } };
    },
  });
  const env = { DB: { prepare: (sql) => makeStmt(sql) } };
  const res = await touchSession(env, "s");
  eq("c023b exit_type max_ttl", res.error, "session_max_ttl");
  const maxBoundaryMs = enteredMs + MAX_MS;
  eq("c023b left_at = max boundary", store.s.left_at, new Date(maxBoundaryMs).toISOString());
  eq(
    "c023b elapsed == MAX (no inflation)",
    Math.round((new Date(store.s.left_at).getTime() - enteredMs) / 1000),
    MAX_SESSION_SECONDS
  );
}

// --- 7. Determinism ---
{
  const s = session({ enteredAgoMs: MAX_MS + 10_000, lastActivityAgoMs: 5_000 });
  const a = JSON.stringify(chooseStaleClosure(s, NOW));
  const b = JSON.stringify(chooseStaleClosure(s, NOW));
  eq("deterministic", a, b);
}

if (failures.length) {
  console.error("Lounge sessions self-test FAILED:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n${failures.length} issue(s).`);
  process.exit(1);
}

console.log(
  "Lounge sessions self-test OK — chooseStaleClosure() closes at the earlier of idle/max-TTL, ties resolve to max_ttl, and left_at never inflates past MAX_SESSION_SECONDS (C-012)."
);
