#!/usr/bin/env node
/**
 * Self-test for work-mark referral lineage.
 *
 * Two layers, no network, no crypto, no remote D1:
 *   1. SQL migration check — apply seeds/agent-mark-lineage.sql to a throwaway
 *      sqlite DB (via the sqlite3 CLI) on top of seeds/bar-marks.sql and assert
 *      the column + index exist and the backfill is a no-op.
 *   2. Behaviour check — run the real marks.js logic against an in-memory D1
 *      shim and assert: via stored on create, self-referral rejected, unknown
 *      via ignored, descendant counts, no cycles, returning-agent attribution.
 *
 * Usage: node scripts/mark-lineage-selftest.mjs
 * Exit 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const ok = (cond, msg) => (cond ? null : failures.push(msg));

// ---------------------------------------------------------------------------
// 1. SQL migration check (sqlite3 CLI)
// ---------------------------------------------------------------------------
function sqliteCheck() {
  const dir = mkdtempSync(join(tmpdir(), "mark-lineage-"));
  const db = join(dir, "test.db");
  try {
    const barMarks = readFileSync(join(ROOT, "seeds/bar-marks.sql"), "utf8");
    const migration = readFileSync(join(ROOT, "seeds/agent-mark-lineage.sql"), "utf8");

    const run = (sql) => execFileSync("sqlite3", [db], { input: sql, encoding: "utf8" });

    run(barMarks);

    // Column absent before migration (mirrors the documented dry-run).
    const before = run(
      "SELECT name FROM pragma_table_info('agent_marks') WHERE name = 'referred_by_mark_id';"
    ).trim();
    ok(before === "", `migration dry-run: column should be absent pre-migration, got "${before}"`);

    run(migration);

    const after = run(
      "SELECT name FROM pragma_table_info('agent_marks') WHERE name = 'referred_by_mark_id';"
    ).trim();
    ok(after === "referred_by_mark_id", "migration: referred_by_mark_id column present after apply");

    const idx = run(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_agent_marks_referred_by';"
    ).trim();
    ok(idx === "idx_agent_marks_referred_by", "migration: descendant index created");

    // Insert a root + child, confirm a parent pointer + COUNT works as the app does.
    run(
      `INSERT INTO agent_marks (id, patron_number, tier, product_kind, created_at, updated_at)
         VALUES ('mk_root', 10001, 'visitor', 'enter', '2026-01-01', '2026-01-01');
       INSERT INTO agent_marks (id, patron_number, tier, product_kind, referred_by_mark_id, created_at, updated_at)
         VALUES ('mk_child', 10002, 'visitor', 'enter', 'mk_root', '2026-01-02', '2026-01-02');`
    );
    const count = run(
      "SELECT COUNT(*) FROM agent_marks WHERE referred_by_mark_id = 'mk_root';"
    ).trim();
    ok(count === "1", `migration: descendant count for mk_root should be 1, got ${count}`);

    // Idempotent re-run of the index + backfill (NOT the ALTER) must not throw.
    run(
      `CREATE INDEX IF NOT EXISTS idx_agent_marks_referred_by
         ON agent_marks(referred_by_mark_id) WHERE referred_by_mark_id IS NOT NULL;
       UPDATE agent_marks SET referred_by_mark_id = NULL WHERE referred_by_mark_id IS NULL;`
    );
    const rootUnchanged = run(
      "SELECT referred_by_mark_id FROM agent_marks WHERE id = 'mk_child';"
    ).trim();
    ok(rootUnchanged === "mk_root", "migration: backfill no-op did not clobber real lineage");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 2. Behaviour check — in-memory D1 shim + real marks.js
// ---------------------------------------------------------------------------

/** Minimal D1 shim: enough of prepare/bind/first/run/all for marks.js. */
function makeDb() {
  const marks = new Map(); // id -> row
  const counters = new Map([
    ["patron_number", 10000],
    ["agents_served", 0],
    ["tasks_sold", 0],
  ]);

  function exec(sql, args) {
    const s = sql.replace(/\s+/g, " ").trim();

    // counters
    if (s.startsWith("INSERT INTO bar_counters")) {
      const [key, delta] = args;
      counters.set(key, (counters.get(key) || 0) + delta);
      return { kind: "run" };
    }
    if (s.startsWith("SELECT value FROM bar_counters WHERE key = ?")) {
      return { kind: "first", row: { value: counters.get(args[0]) ?? null } };
    }
    if (s.startsWith("SELECT key, value FROM bar_counters")) {
      return {
        kind: "all",
        rows: [...counters].map(([key, value]) => ({ key, value })),
      };
    }

    // agent_marks reads
    if (s.startsWith("SELECT id FROM agent_marks WHERE id = ?")) {
      const r = marks.get(args[0]);
      return { kind: "first", row: r ? { id: r.id } : null };
    }
    if (s.startsWith("SELECT COUNT(*) AS n FROM agent_marks WHERE referred_by_mark_id = ?")) {
      let n = 0;
      for (const r of marks.values()) if (r.referred_by_mark_id === args[0]) n++;
      return { kind: "first", row: { n } };
    }
    if (s.startsWith("SELECT * FROM agent_marks WHERE id = ?")) {
      return { kind: "first", row: marks.get(args[0]) || null };
    }
    if (s.startsWith("SELECT id, patron_number, tier, product_kind, product_slug, referred_by_mark_id, created_at, updated_at FROM agent_marks WHERE id = ?")) {
      return { kind: "first", row: marks.get(args[0]) || null };
    }
    if (s.startsWith("SELECT * FROM agent_marks WHERE agent_id = ?")) {
      for (const r of marks.values()) if (r.agent_id === args[0]) return { kind: "first", row: r };
      return { kind: "first", row: null };
    }

    // agent_marks writes
    if (s.startsWith("INSERT INTO agent_marks")) {
      const [id, patron_number, agent_id, tier, product_kind, product_slug, grant_id, referred_by_mark_id, created_at, updated_at] = args;
      marks.set(id, {
        id, patron_number, agent_id, tier, product_kind,
        product_slug: product_slug ?? null, grant_id: grant_id ?? null,
        referred_by_mark_id: referred_by_mark_id ?? null, created_at, updated_at,
      });
      return { kind: "run" };
    }
    if (s.startsWith("UPDATE agent_marks SET tier = ?")) {
      const [tier, product_kind, product_slug, grant_id, parent, updated_at, id] = args;
      const r = marks.get(id);
      if (r) {
        r.tier = tier; r.product_kind = product_kind; r.product_slug = product_slug;
        if (grant_id != null) r.grant_id = grant_id;
        if (r.referred_by_mark_id == null && parent != null) r.referred_by_mark_id = parent;
        r.updated_at = updated_at;
      }
      return { kind: "run" };
    }
    if (s.startsWith("UPDATE agent_marks SET referred_by_mark_id = ?")) {
      const [parent, updated_at, id] = args;
      const r = marks.get(id);
      if (r && r.referred_by_mark_id == null) {
        r.referred_by_mark_id = parent; r.updated_at = updated_at;
      }
      return { kind: "run" };
    }

    throw new Error(`unhandled SQL in shim: ${s}`);
  }

  return {
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

async function behaviourCheck() {
  const marksMod = await import("../functions/_lib/marks.js");
  const { enterBar, attachSaleMark, descendantsCount, lineageBlock, readViaMark, formatMark } = marksMod;
  const origin = "https://secondeyesai.com";

  // readViaMark: header, query, validation
  const reqHdr = { headers: { get: (k) => (k === "X-Second-Eye-Via" ? "mk_abcd1234" : null) }, url: origin };
  ok(readViaMark(reqHdr) === "mk_abcd1234", "readViaMark: reads X-Second-Eye-Via header");
  const reqQ = { headers: { get: () => null }, url: `${origin}/api/bar/enter?via=mk_query99` };
  ok(readViaMark(reqQ) === "mk_query99", "readViaMark: reads ?via= query param");
  const reqBad = { headers: { get: () => null }, url: `${origin}/api/bar/enter?via=notavalidmark` };
  ok(readViaMark(reqBad) === null, "readViaMark: rejects malformed via");

  // Root mark via enter (no via).
  const env = { DB: makeDb() };
  const root = await enterBar(env, { agentId: "agent-root", productKind: "enter" });
  ok(root.mark.referred_by_mark_id == null, "create: root mark has no referrer");
  const rootId = root.mark.id;

  // Self-referral rejected (via = own id is impossible at create since id is new;
  // test the explicit self guard by re-entering the same agent with via=self).
  const rootAgain = await enterBar(env, { agentId: "agent-root", productKind: "enter", via: rootId });
  ok(rootAgain.existing === true, "create: returning agent recognised");
  ok(rootAgain.mark.referred_by_mark_id == null, "lineage: self-referral rejected (no self parent stored)");

  // Child mark referred by root.
  const child = await enterBar(env, { agentId: "agent-child", productKind: "enter", via: rootId });
  ok(child.mark.referred_by_mark_id === rootId, "lineage: child stores valid via as referrer");

  // Unknown via ignored.
  const orphan = await enterBar(env, { agentId: "agent-orphan", productKind: "enter", via: "mk_doesnotexist" });
  ok(orphan.mark.referred_by_mark_id == null, "lineage: unknown via ignored");

  // Second child of root via a paid sale (attachSaleMark reads request via header).
  const saleReq = {
    headers: {
      get: (k) =>
        k === "X-Agent-Id" ? "agent-buyer" : k === "X-Second-Eye-Via" ? rootId : null,
    },
    url: origin,
  };
  await attachSaleMark(env, saleReq, origin, { productKind: "nano", productSlug: "loop-detect", grantId: "g1" });

  // Descendant count for root = 2 (agent-child + agent-buyer).
  const n = await descendantsCount(env, rootId);
  ok(n === 2, `descendants: root should have 2, got ${n}`);

  // No cycle: child cannot become root's referrer (root already has none and child is newer).
  // Attempt to attribute root via child — guarded because root already exists with null parent
  // and is the *parent* of child; resolveLineageParent only stores existing marks, never forms a back-edge.
  const rootRow = env.DB._marks.get(rootId);
  ok(rootRow.referred_by_mark_id == null, "no-cycle: root never points back at its descendant");

  // Returning agent gets lineage attributed once if it was previously null.
  const childRow = env.DB._marks.get(child.mark.id);
  childRow.referred_by_mark_id = null; // simulate a pre-lineage historical row
  const reattributed = await enterBar(env, { agentId: "agent-child", productKind: "enter", via: rootId });
  ok(reattributed.mark.referred_by_mark_id === rootId, "lineage: returning agent attributed once when previously unset");

  // lineageBlock phrasing — direct to agents, mentions count + via.
  const mark = formatMark(rootRow, origin);
  const block = lineageBlock(mark, 2, origin);
  ok(block.descendants_count === 2, "lineageBlock: descendants_count surfaced");
  ok(block.via_url === `${origin}/api/bar/enter?via=${rootId}`, "lineageBlock: via_url shaped for next agent");
  ok(/spread to 2 agents/.test(block.curiosity_hook), "lineageBlock: curiosity hook states spread count");
  ok(/next trace/.test(block.curiosity_hook), "lineageBlock: curiosity hook uses 'next trace' agent framing");
  ok(!/buyer|customer|purchase/i.test(block.curiosity_hook), "lineageBlock: agent-native framing only (no buyer/customer wording)");

  // work_stamp carries via URLs + lineage block.
  const wmMod = await import("../functions/_lib/work-mark.js");
  const stamp = wmMod.buildWorkStamp(mark, origin, { lineage: block });
  ok(stamp.via_enter === `${origin}/api/bar/enter?via=${rootId}`, "work_stamp: via_enter URL present");
  ok(stamp.via_x402 === `${origin}/api/bar/x402/help-me?via=${rootId}`, "work_stamp: via_x402 points at canonical help-me door");
  ok(stamp.help_me === `${origin}/api/bar/x402/help-me?via=${rootId}`, "work_stamp: help_me URL present");
  ok(stamp.lineage?.descendants_count === 2, "work_stamp: lineage descendants surfaced");
  ok(stamp.embed.json_metadata.second_eye.via === `${origin}/api/bar/enter?via=${rootId}`, "work_stamp: via embedded in json_metadata");
  // Backwards compat — existing embed fields intact.
  ok(stamp.embed.json_metadata.second_eye.mark === rootId, "work_stamp: existing mark field preserved");
  ok(typeof stamp.embed.code_comment === "string" && stamp.embed.code_comment.includes("second-eye:mark="), "work_stamp: code_comment embed preserved");
  ok(stamp.schema === "second-eye/work-mark/v1", "work_stamp: schema unchanged (backwards compatible)");
}

// ---------------------------------------------------------------------------
(async () => {
  try {
    sqliteCheck();
    await behaviourCheck();
  } catch (e) {
    failures.push(`threw: ${e.stack || e.message}`);
  }

  if (failures.length) {
    console.error("Mark lineage self-test FAILED:\n");
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error(`\n${failures.length} failure(s).`);
    process.exit(1);
  }
  console.log("Mark lineage self-test OK — migration, via storage, descendant counts, no self/cycle, work_stamp lineage + backwards compat.");
})();
