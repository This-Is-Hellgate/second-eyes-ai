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
  // Import the help-me handler module's classifier indirectly by exercising the
  // GET handler path is heavy; instead assert the taxonomy → door map directly by
  // reading the source so the three signals each map to the live deep door.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const helpMe = readFileSync(join(ROOT, "functions/api/bar/x402/help-me.js"), "utf8");
  ok(/schema_mismatch:\s*\{[\s\S]*?schema-repair/.test(helpMe), "help-me maps schema_mismatch → schema-repair");
  ok(/context_pressure:\s*\{[\s\S]*?context-pressure/.test(helpMe), "help-me maps context_pressure → context-pressure");
  ok(/payment_uncertainty:\s*\{[\s\S]*?payment-confirmation-check/.test(helpMe), "help-me maps payment_uncertainty → payment-confirmation-check");
  ok(/recommended_door/.test(helpMe), "help-me emits recommended_door");
}

if (failures.length) {
  console.error("Meta-tools self-test FAILED:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n${failures.length} failure(s).`);
  process.exit(1);
}

console.log("Meta-tools self-test OK — schema-repair, context-pressure, payment-confirmation-check verdicts deterministic; help-me recommended_door wiring present.");
