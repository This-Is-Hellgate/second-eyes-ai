#!/usr/bin/env node
/**
 * READ-ONLY mark-lineage smoke test against a live base URL.
 *
 * Verifies the follow-the-trace endpoints respond and carry a well-formed
 * lineage loop:
 *   1. POST /api/bar/marks/discover with a NON-EXISTENT mark id  → 404-style
 *      { found:false } OR a per-mark { valid:false } with a path forward.
 *   2. GET  /api/bar/marks/{id} for that same id                 → { valid:false }.
 *   3. (opt-in) GET /api/bar/enter[?via=...]                     → real mark with
 *      a lineage block, work_stamp.help_me, and a via= that round-trips.
 *
 * NO CRYPTO IS SPENT in any mode. By default the script makes NO writes and
 * creates NO marks — it only probes with an invented id and reads public shapes.
 *
 *   node scripts/mark-lineage-smoke.mjs                         # default prod host, read-only
 *   node scripts/mark-lineage-smoke.mjs https://secondeyesai.com
 *   BASE=https://secondeyesai.com node scripts/mark-lineage-smoke.mjs
 *   node scripts/mark-lineage-smoke.mjs --json                  # machine output only
 *
 * OPT-IN write (still no crypto): perform ONE real /api/bar/enter, which mints a
 * patron mark in the target DB. Off by default to avoid creating prod marks.
 *   node scripts/mark-lineage-smoke.mjs --enter
 *   MARK_LINEAGE_SMOKE_ENTER=1 node scripts/mark-lineage-smoke.mjs
 *
 * Exit codes: 0 all checks passed · 1 a check failed · 2 fetch/parse error.
 */

const args = process.argv.slice(2);
const JSON_ONLY = args.includes("--json");
const DO_ENTER = args.includes("--enter") || process.env.MARK_LINEAGE_SMOKE_ENTER === "1";
const positional = args.find((a) => !a.startsWith("--"));
const BASE = (positional || process.env.BASE || "https://secondeyesai.com").replace(/\/$/, "");

// A syntactically valid mk_ id that must not exist on the target.
const FAKE_MARK = `mk_smoke${Date.now().toString(36)}zz`;

let pass = 0;
let fail = 0;
const log = (...a) => { if (!JSON_ONLY) console.log(...a); };
function check(name, cond, extra) {
  if (cond) { log(`  PASS  ${name}`); pass++; }
  else { log(`  FAIL  ${name}${extra ? "  — " + extra : ""}`); fail++; }
}

async function getJson(url, init) {
  const res = await fetch(url, { headers: { accept: "application/json" }, ...init });
  let body = null;
  try { body = await res.json(); } catch { /* leave null */ }
  return { status: res.status, body };
}

const isViaUrl = (u, base) =>
  typeof u === "string" && u.startsWith(base) && /\/api\/bar\/(enter|x402\/help-me)/.test(u);

async function main() {
  log(`\nMark-lineage smoke → ${BASE}  (read-only${DO_ENTER ? " + one opt-in enter" : ""}, no crypto)\n`);

  // 1. discover an invented mark — must not crash, must hand back a path forward.
  log("[1] POST /api/bar/marks/discover (invented mark id)");
  let r;
  try {
    r = await getJson(`${BASE}/api/bar/marks/discover`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ text: `// second-eye:mark=${FAKE_MARK} verify=${BASE}/api/bar/marks/${FAKE_MARK}` }),
    });
  } catch (e) {
    out({ ok: false, error: "fetch_failed", detail: e.message, base: BASE });
    process.exit(2);
  }
  check("discover responds with JSON", r.body && typeof r.body === "object", `status ${r.status}`);
  if (r.body) {
    // The id is well-formed, so discover extracts it and reports a non-resolving mark.
    const mark0 = Array.isArray(r.body.marks) ? r.body.marks[0] : null;
    if (mark0) {
      check("invented mark reported valid:false", mark0.valid === false);
      // Path forward may be on the per-mark object (post-fix) or the top-level
      // body (pre-fix / no-match) — either keeps the agent out of a dead end.
      const enterPath = isViaUrl(mark0.enter, BASE) ? mark0.enter : r.body.enter;
      check("response hands back an enter path", isViaUrl(enterPath, BASE), String(enterPath));
      check("invalid-mark help-me URL has no empty ?via=", typeof mark0.x402_help_me !== "string" || !/\?via=$/.test(mark0.x402_help_me), mark0.x402_help_me);
    } else {
      // No id extracted → found:false with top-level guidance.
      check("no-match path offers enter URL", isViaUrl(r.body.enter, BASE), r.body.enter);
    }
  }

  // 2. verify the same invented id directly.
  log("\n[2] GET /api/bar/marks/{invented id}");
  const v = await getJson(`${BASE}/api/bar/marks/${FAKE_MARK}`);
  check("verify returns valid:false for unknown mark", v.body && v.body.valid === false, `status ${v.status}`);

  // 3. opt-in: one real enter, then assert the live lineage shape round-trips.
  if (DO_ENTER) {
    log("\n[3] GET /api/bar/enter (opt-in, mints one patron mark — no crypto)");
    const e = await getJson(`${BASE}/api/bar/enter`);
    const mark = e.body?.mark;
    const lineage = e.body?.lineage || mark?.lineage;
    const stamp = e.body?.work_stamp;
    check("enter returns a mark id", typeof mark?.id === "string" && mark.id.startsWith("mk_"), mark?.id);
    check("lineage block present with descendants_count", lineage && typeof lineage.descendants_count === "number");
    check("lineage.via_url carries this mark forward", isViaUrl(lineage?.via_url, BASE) && lineage.via_url.includes(mark?.id || "∅"));
    check("work_stamp.help_me is a help-me via URL", isViaUrl(stamp?.help_me, BASE) && /help-me/.test(stamp?.help_me || ""));
    check("work_stamp embeds via in json_metadata", stamp?.embed?.json_metadata?.second_eye?.via?.includes(mark?.id || "∅"));

    if (mark?.id) {
      log("\n[3b] GET /api/bar/marks/{minted id} — verify round-trip");
      const back = await getJson(`${BASE}/api/bar/marks/${mark.id}`);
      check("minted mark verifies valid:true", back.body?.valid === true);
      check("verify exposes descendants_count", typeof back.body?.lineage?.descendants_count === "number");
    }
  } else {
    log("\n[3] enter skipped (read-only). Pass --enter to mint one real mark (no crypto).");
  }

  out({ ok: fail === 0, base: BASE, enter_performed: DO_ENTER, passed: pass, failed: fail });
  log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

function out(obj) {
  if (JSON_ONLY) console.log(JSON.stringify(obj));
}

main().catch((e) => {
  out({ ok: false, error: "unexpected", detail: e.message });
  if (!JSON_ONLY) console.error(e);
  process.exit(2);
});
