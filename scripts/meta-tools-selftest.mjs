#!/usr/bin/env node
/**
 * Self-test for the deep single-concern meta-tools logic
 * (functions/_lib/lounge/meta-tools.js): schema-repair, context-pressure,
 * payment-confirmation-check. Pure functions — no network, no crypto, no D1.
 *
 * Asserts the deterministic stop/preserve/continue verdicts and the named
 * classes/bands an autonomous agent depends on being stable across retries, plus
 * that help-me's taxonomy surfaces a recommended_door for the three signals.
 *
 * Usage: node scripts/meta-tools-selftest.mjs    (exit 1 on any failure)
 */

import {
  diagnoseSchema,
  diagnoseContext,
  diagnosePaymentConfirmation,
  toFraction,
} from "../functions/_lib/lounge/meta-tools.js";

const failures = [];
const ok = (cond, msg) => (cond ? null : failures.push(msg));
const eq = (got, want, msg) => ok(got === want, `${msg} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const VERDICTS = new Set(["stop", "preserve", "continue"]);

/* ---------- toFraction ---------- */
eq(toFraction("12%"), 0.12, "toFraction percent string");
eq(toFraction(0.12), 0.12, "toFraction fraction number");
eq(toFraction(85), 0.85, "toFraction >1 number treated as percent");
eq(toFraction(""), null, "toFraction empty");
eq(toFraction("nonsense"), null, "toFraction garbage");

/* ---------- schema-repair ---------- */
{
  const r = diagnoseSchema({ error: "expected string, got number" });
  eq(r.tool, "schema-repair", "schema tool name");
  eq(r.repair_class, "type_mismatch", "schema type mismatch class");
  eq(r.fixable_client_side, true, "type mismatch is client-fixable");
  ok(VERDICTS.has(r.verdict), "schema verdict in set");
  ok(typeof r.repair_recipe === "string" && r.repair_recipe.length > 0, "schema recipe present");

  const poison = diagnoseSchema({ error: "tool definition changed — possible MCP poisoning" });
  eq(poison.repair_class, "schema_poisoning_suspected", "schema poisoning class");
  eq(poison.fixable_client_side, false, "poisoning not client-fixable");
  eq(poison.verdict, "stop", "poisoning verdict stop");
  ok(/always/.test(poison.escalate_if), "poisoning escalates always");

  const missing = diagnoseSchema({ error: "field 'query' is required" });
  eq(missing.repair_class, "missing_required_field", "schema missing required class");

  const unreachable = diagnoseSchema({ error: "cannot load schema: 404" });
  eq(unreachable.repair_class, "schema_unreachable", "schema unreachable class");
  eq(unreachable.fixable_client_side, false, "unreachable not client-fixable");

  // Determinism: same input → identical result.
  const a = JSON.stringify(diagnoseSchema({ error: "additionalProperties not allowed" }));
  const b = JSON.stringify(diagnoseSchema({ error: "additionalProperties not allowed" }));
  eq(a, b, "schema-repair deterministic");
}

/* ---------- context-pressure ---------- */
{
  const headroom = diagnoseContext({ remaining_context: "80%" }); // 20% used
  eq(headroom.pressure_band, "headroom", "context headroom band");
  eq(headroom.verdict, "continue", "headroom verdict continue");
  eq(headroom.next_call, null, "headroom no next_call");

  const proactive = diagnoseContext({ remaining_context: "25%" }); // 75% used
  eq(proactive.pressure_band, "compact_proactively", "context proactive band");
  eq(proactive.verdict, "preserve", "proactive verdict preserve");

  const stopCompact = diagnoseContext({ remaining_context: "10%" }); // 90% used
  eq(stopCompact.pressure_band, "stop_and_compact", "context stop_and_compact band");
  eq(stopCompact.verdict, "stop", "stop_and_compact verdict stop");
  ok(/context-compress/.test(stopCompact.next_call), "stop_and_compact routes to context-compress");

  const critical = diagnoseContext({ remaining_context: "3%" }); // 97% used
  eq(critical.pressure_band, "critical", "context critical band");
  ok(/context-recover/.test(critical.next_call), "critical routes to context-recover");

  const byTokens = diagnoseContext({ tokens_used: 185000, token_budget: 200000 }); // 92.5% used
  eq(byTokens.pressure_band, "stop_and_compact", "context band from token counts");

  const unknown = diagnoseContext({});
  eq(unknown.pressure_band, "unknown_assume_high", "context unknown → conservative band");
  eq(unknown.verdict, "stop", "unknown verdict conservative stop");
  ok(typeof unknown.note === "string", "unknown has explanatory note");

  const a = JSON.stringify(diagnoseContext({ remaining_context: "12%" }));
  const b = JSON.stringify(diagnoseContext({ remaining_context: "12%" }));
  eq(a, b, "context-pressure deterministic");
}

/* ---------- payment-confirmation-check ---------- */
{
  const fulfilled = diagnosePaymentConfirmation({ http_status: 409, error: "payment already fulfilled" });
  eq(fulfilled.payment_class, "already_fulfilled", "payment already_fulfilled class");
  eq(fulfilled.verdict, "stop", "already_fulfilled verdict stop");

  // C-008: snake_case/kebab fulfilled error codes (bar-pay.js / stripe-x402.js
  // emit payment_already_fulfilled / already_fulfilled) are a fulfilled signal
  // even WITHOUT http 409 — many idempotent replies come back 200. Space-only
  // matching missed these; the agent must not double-pay.
  for (const code of [
    "payment_already_fulfilled",
    "already_fulfilled",
    "already_settled",
    "already-settled",
    "payment_already_paid",
    "duplicate_payment",
  ]) {
    const snake = diagnosePaymentConfirmation({ error: code });
    eq(snake.payment_class, "already_fulfilled", `snake_case "${code}" → already_fulfilled (no 409)`);
    eq(snake.verdict, "stop", `snake_case "${code}" → stop (no double-pay)`);
  }

  const failed = diagnosePaymentConfirmation({ status: "failed", error: "insufficient funds" });
  eq(failed.payment_class, "failed", "payment failed class");
  ok(/escalate|approval|boundary/.test(failed.escalate_if), "failed insufficient escalates");

  const pending = diagnosePaymentConfirmation({ tx: "0xabc123def456", status: "pending" });
  eq(pending.payment_class, "pending_confirmation", "payment pending class");
  eq(pending.has_tx_hash, true, "pending detects tx hash");
  eq(pending.verdict, "preserve", "pending verdict preserve");

  const noReceipt = diagnosePaymentConfirmation({});
  eq(noReceipt.payment_class, "unconfirmed_no_receipt", "payment no-receipt class");

  const confirmed = diagnosePaymentConfirmation({ tx: "0x434539cb8ce48cb6", status: "confirmed" });
  eq(confirmed.payment_class, "confirmed", "payment confirmed class");
  eq(confirmed.verdict, "continue", "confirmed verdict continue");

  const a = JSON.stringify(diagnosePaymentConfirmation({ tx: "0xabc123", status: "pending" }));
  const b = JSON.stringify(diagnosePaymentConfirmation({ tx: "0xabc123", status: "pending" }));
  eq(a, b, "payment-confirmation-check deterministic");
}

/* ---------- help-me recommended_door wiring ---------- */
{
  const { classifyDistress } = await import("../functions/api/bar/x402/help-me.js");
  const ORIGIN = "https://secondeyesai.com";

  const schema = classifyDistress({ error: "schema validation failed" }, ORIGIN);
  eq(schema.distress_class, "schema_mismatch", "classify schema_mismatch");
  eq(schema.recommended_door.slug, "schema-repair", "schema_mismatch → schema-repair door");

  const ctx = classifyDistress({ state: "running out of context window" }, ORIGIN);
  eq(ctx.distress_class, "context_pressure", "classify context_pressure");
  eq(ctx.recommended_door.slug, "context-pressure", "context_pressure → context-pressure door");

  // PRE-payment phrasing must route to should-i-pay, NOT payment-confirmation-check.
  // Recommending a settlement check before any payment exists is the bug we fixed.
  for (const phrase of ["about to pay", "should I pay for this?", "is it worth paying", "hit a 402 paywall"]) {
    const pre = classifyDistress({ risk: phrase }, ORIGIN);
    eq(pre.distress_class, "payment_decision", `pre-payment "${phrase}" → payment_decision`);
    eq(pre.recommended_door.slug, "should-i-pay", `pre-payment "${phrase}" → should-i-pay door`);
    ok(
      pre.recommended_door.path === "/api/bar/x402/should-i-pay",
      `pre-payment "${phrase}" door path is the session-less x402 twin`
    );
  }

  // POST-payment / settlement uncertainty still routes to payment-confirmation-check.
  for (const phrase of ["already paid, did it go through?", "tx submitted, settle pending", "worried about a double charge"]) {
    const post = classifyDistress({ state: phrase }, ORIGIN);
    eq(post.distress_class, "payment_settlement_uncertainty", `post-payment "${phrase}" → settlement uncertainty`);
    eq(post.recommended_door.slug, "payment-confirmation-check", `post-payment "${phrase}" → payment-confirmation-check door`);
  }
}

if (failures.length) {
  console.error("Meta-tools self-test FAILED:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n${failures.length} failure(s).`);
  process.exit(1);
}

console.log("Meta-tools self-test OK — schema-repair, context-pressure, payment-confirmation-check verdicts deterministic; help-me recommended_door wiring present.");
