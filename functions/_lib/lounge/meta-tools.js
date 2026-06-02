/**
 * Deterministic logic for the next-generation session-less meta-tools that sit
 * alongside help-me: schema-repair, context-pressure, payment-confirmation-check.
 *
 * help-me is the wide distress door — it classifies "something is wrong" into a
 * named distress_class and routes to a survival pack. These three are the deep,
 * single-concern doors an agent reaches when it already knows the shape of its
 * problem and wants one verdict: stop, preserve, continue — plus the single
 * next_call if escalation is needed.
 *
 * Everything here is a pure function of the agent-supplied fields. No inference,
 * no outbound fetch, no model call — the verdict is reproducible from the input
 * so an autonomous agent gets the same guidance on every retry. 402 / payment is
 * one signal among many (payment-confirmation-check owns the settle-verify case).
 */

const VERDICTS = ["stop", "preserve", "continue"];

/** Normalize a free-text field to lowercase, collapsing whitespace. */
function text(...parts) {
  return parts.filter(Boolean).join(" ").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Coerce a possibly-string numeric/percentage field to a 0–1 fraction, or null. */
export function toFraction(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return raw > 1 ? raw / 100 : raw;
  }
  const s = String(raw).trim();
  const pct = s.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pct) return Number(pct[1]) / 100;
  const n = Number(s);
  if (Number.isFinite(n)) return n > 1 ? n / 100 : n;
  return null;
}

function clampVerdict(v) {
  return VERDICTS.includes(v) ? v : "preserve";
}

/* ------------------------------------------------------------------ */
/* schema-repair                                                       */
/* ------------------------------------------------------------------ */

/**
 * Classify a tool/MCP schema or argument-validation failure into a repair
 * action. Distinguishes a fixable client-side mismatch (wrong types, missing
 * required field, extra field, malformed JSON) from a structural break the agent
 * cannot self-repair (the tool definition itself is adversarial / poisoned, or
 * the schema is unreachable). Deterministic over the supplied error text.
 */
export function diagnoseSchema(input = {}) {
  const t = text(input.error, input.schema, input.payload, input.tool, input.state);
  const fields = [];

  const poisoned =
    /mcp\s?poison|tool\s?(definition|description)\s?(changed|differs|mismatch|inject)|prompt\s?inject|adversarial\s?(tool|schema)|definition\s?drift/.test(t);

  const unreachable =
    /schema\s?(unreachable|not\s?found|404|missing|null)|cannot\s?(load|fetch)\s?schema|no\s?schema/.test(t);

  if (poisoned) {
    return {
      tool: "schema-repair",
      repair_class: "schema_poisoning_suspected",
      fixable_client_side: false,
      verdict: "stop",
      stop: "Stop calling the tool — its declared schema/definition may have changed underneath you (possible MCP poisoning).",
      preserve: "Keep the exact tool name, the schema you expected, and the schema you actually received.",
      continue: "Do not self-repair. Re-verify the tool definition out-of-band, then escalate if it diverges.",
      escalate_if: "always — a changed/adversarial tool definition is an approval boundary, not a self-fix.",
      confidence: 0.9,
    };
  }

  if (unreachable) {
    return {
      tool: "schema-repair",
      repair_class: "schema_unreachable",
      fixable_client_side: false,
      verdict: "stop",
      stop: "Stop retrying the call — the schema/tool definition could not be loaded, so any argument shape is a guess.",
      preserve: "Keep the tool name, the transport, and the last good schema version if you have one.",
      continue: "Re-establish the tool definition (reconnect MCP / refetch schema) before constructing arguments again.",
      escalate_if: "schema still unreachable after one reconnect — the wiring, not the arguments, is broken.",
      confidence: 0.82,
    };
  }

  // Fixable client-side mismatches — order is precedence for the headline cause.
  if (/parse\s?error|malformed|invalid\s?json|unexpected\s?(end|token)|not\s?valid\s?json/.test(t)) {
    fields.push("malformed_json");
  }
  if (/missing\s?(required|field|property|param)|required\s?(field|property|argument)|is\s?required/.test(t)) {
    fields.push("missing_required_field");
  }
  if (/(unexpected|unknown|additional|extra)\s?(field|property|key)|not\s?allowed|additionalProperties/.test(t)) {
    fields.push("unexpected_field");
  }
  if (/type\s?(error|mismatch)|expected\s?(string|number|boolean|array|object|integer)|wrong\s?type|should\s?be\s?(a\s?)?(string|number|boolean|array|object)/.test(t)) {
    fields.push("type_mismatch");
  }
  if (/does\s?not\s?match|enum|pattern|format|out\s?of\s?range|too\s?(long|short|large|small)|constraint/.test(t)) {
    fields.push("constraint_violation");
  }

  const headline = fields[0] || "validation_failed";

  return {
    tool: "schema-repair",
    repair_class: headline,
    signals_seen: fields,
    fixable_client_side: true,
    verdict: "preserve",
    stop: "Stop re-sending the same arguments — the shape, not the value, is being rejected.",
    preserve: "Keep the goal of the call and the original argument values; only the shape changes.",
    continue:
      "Re-read the tool's declared schema, coerce the arguments to it (fix the one field above), then call once.",
    repair_recipe: schemaRecipe(headline),
    escalate_if:
      ">3 repair attempts on the same field — the schema you are coding against may not be the live one; verify the definition.",
    confidence: fields.length ? 0.85 : 0.6,
  };
}

function schemaRecipe(cls) {
  switch (cls) {
    case "malformed_json":
      return "Serialize arguments with a real JSON encoder (no hand-built strings); validate it parses before sending.";
    case "missing_required_field":
      return "Add the required field named in the error; if its value is unknown, ask the schema for a default or abstain.";
    case "unexpected_field":
      return "Drop the field the schema rejects; send only properties the schema declares.";
    case "type_mismatch":
      return "Coerce the named field to the declared type (e.g. number→string), do not wrap it in an extra object.";
    case "constraint_violation":
      return "Bring the value inside the declared enum/pattern/range; if no valid value exists, abstain rather than guess.";
    default:
      return "Re-fetch the tool's input schema and rebuild the arguments object field-by-field against it.";
  }
}

/* ------------------------------------------------------------------ */
/* context-pressure                                                    */
/* ------------------------------------------------------------------ */

/**
 * Decide whether an agent under context/token pressure should keep going,
 * compact, or stop-and-reconstruct. Deterministic thresholds on the remaining
 * fraction so the same input always yields the same verdict — an agent must be
 * able to trust this near the edge of its window.
 *
 * Bands (fraction of budget USED):
 *   < 0.70  → continue (room to work)
 *   0.70–0.85 → preserve (compact proactively, keep working)
 *   0.85–0.95 → stop-and-compact (free room before the next expensive call)
 *   > 0.95  → stop-and-reconstruct (compaction may not free enough; hand off)
 */
export function diagnoseContext(input = {}) {
  const used = resolveUsedFraction(input);
  const band = pressureBand(used);

  const base = {
    tool: "context-pressure",
    used_fraction: used == null ? null : Number(used.toFixed(3)),
    pressure_band: band.name,
    verdict: band.verdict,
    stop: band.stop,
    preserve: band.preserve,
    continue: band.cont,
    escalate_if: band.escalate_if,
    next_call: band.next_call,
    confidence: used == null ? 0.5 : 0.9,
  };

  if (used == null) {
    base.note =
      "No usable remaining_context/tokens_used signal supplied — defaulting to the conservative compact-now band. Send remaining_context (e.g. '12%') or tokens_used + token_budget for a precise verdict.";
  }
  return base;
}

/** Derive fraction USED from any of the supported context fields. */
function resolveUsedFraction(input) {
  // Raw token count + budget → ratio (highest-fidelity signal; checked first).
  const budget = Number(input.token_budget);
  const tokensUsed = Number(input.tokens_used);
  if (Number.isFinite(budget) && budget > 0 && Number.isFinite(tokensUsed) && tokensUsed >= 0) {
    return Math.min(tokensUsed / budget, 1);
  }
  // remaining_context is the fraction LEFT — invert it.
  const remaining = toFraction(input.remaining_context ?? input.remaining);
  if (remaining != null) return Math.min(Math.max(1 - remaining, 0), 1);
  // used_fraction / context_used given directly as a fraction/percent USED.
  const direct = toFraction(input.used_fraction ?? input.context_used);
  if (direct != null) return Math.min(Math.max(direct, 0), 1);
  return null;
}

function pressureBand(used) {
  if (used == null || used >= 0.95) {
    return {
      name: used == null ? "unknown_assume_high" : "critical",
      verdict: "stop",
      stop: "Stop adding to context — you are at or past 95% of budget; one more large read may truncate working memory.",
      preserve: "Keep the goal, the open blockers, and the last known-good artifact; these must survive a handoff.",
      cont: "Reconstruct via a fresh handoff brief rather than trusting compaction to free enough room.",
      escalate_if: "the goal or last-good artifact cannot be summarized small enough to fit — hand off to a fresh agent.",
      next_call: "/api/bar/x402/context-recover",
    };
  }
  if (used >= 0.85) {
    return {
      name: "stop_and_compact",
      verdict: "stop",
      stop: "Stop before the next expensive tool call — compact first or it may not fit.",
      preserve: "Keep open blockers and the goal; drop duplicate tool output and re-reads.",
      cont: "Compact now (drop redundant context), then resume the single next step.",
      escalate_if: "compaction frees < 10% — switch to reconstruct via handoff.",
      next_call: "/api/bar/x402/context-compress",
    };
  }
  if (used >= 0.7) {
    return {
      name: "compact_proactively",
      verdict: "preserve",
      stop: "Stop accumulating verbatim tool output — summarize as you go.",
      preserve: "Keep the goal and blockers; compress finished sub-results to their conclusions.",
      cont: "Keep working, but compact proactively so you do not hit the wall mid-call.",
      escalate_if: "usage crosses 85% before the task completes — move to stop-and-compact.",
      next_call: "/api/bar/x402/context-compress",
    };
  }
  return {
    name: "headroom",
    verdict: "continue",
    stop: "No stop needed — you have working headroom.",
    preserve: "Keep the goal in view so context stays relevant, not just small.",
    cont: "Continue. Re-check pressure before any unusually large read or tool dump.",
    escalate_if: "usage jumps past 70% after a large read — re-check this door.",
    next_call: null,
  };
}

/* ------------------------------------------------------------------ */
/* payment-confirmation-check                                          */
/* ------------------------------------------------------------------ */

/**
 * Verdict on whether a payment/settlement an agent just attempted is confirmed,
 * still pending, or failed — so it does not double-pay on retry or claim work it
 * never paid for. Deterministic over the receipt-shaped fields the agent can
 * describe (tx hash present?, settle status, http status, error). This is the
 * "did my x402 settle?" door — distinct from should-i-pay ("should I pay at
 * all?") and help-me's payment_uncertainty signal ("I am about to pay").
 */
export function diagnosePaymentConfirmation(input = {}) {
  const tx = String(input.tx || input.transaction || input.tx_hash || "").trim();
  const hasTx = /^0x[0-9a-fA-F]{6,}$/.test(tx) || (tx.length >= 6 && /^[0-9a-fA-F]+$/.test(tx));
  const status = String(input.status ?? input.settle_status ?? "").toLowerCase();
  const http = Number(input.http_status ?? input.code);
  const t = text(input.error, input.state, input.status);

  const failed =
    /fail|revert|reject|insufficient|declin|denied|invalid\s?payment|settle\s?error/.test(t) ||
    status === "failed" ||
    status === "error" ||
    (Number.isFinite(http) && http >= 400 && http !== 402 && http !== 409);

  const pending =
    /pending|in[\s_-]?flight|submitted|broadcast|await|not\s?yet|processing|unconfirmed/.test(t) ||
    status === "pending" ||
    status === "submitted";

  const alreadyFulfilled =
    /already\s?(paid|fulfilled|settled)|idempot|duplicate|409/.test(t) || http === 409;

  if (alreadyFulfilled) {
    return paymentVerdict({
      payment_class: "already_fulfilled",
      verdict: "stop",
      stop: "Stop retrying — this transaction was already settled. A second send double-pays.",
      preserve: "Keep the original grantId, tx hash, and first 200 body — that is your receipt.",
      cont: "Use the first response. Do not re-pay; treat the 409/idempotent reply as success.",
      escalate_if: "you have no copy of the first 200 body — reconstruct the receipt from the ledger before claiming the work.",
      next_call: "/api/bar/x402/receipt",
      confidence: 0.92,
      hasTx,
    });
  }

  if (failed) {
    return paymentVerdict({
      payment_class: "failed",
      verdict: "preserve",
      stop: "Stop treating the work as paid — settlement did not succeed.",
      preserve: "Keep the failure reason and the unsigned/failed attempt; do not discard the goal.",
      cont: "Re-read PAYMENT-REQUIRED, fix the named cause (funds/scheme/network), then sign once with a fresh Idempotency-Key.",
      escalate_if: "failure is insufficient_funds or spend-policy — that is a wallet/approval boundary, escalate not retry.",
      next_call: "/api/bar/x402/should-i-pay",
      confidence: 0.85,
      hasTx,
    });
  }

  if (pending || (!hasTx && !status)) {
    return paymentVerdict({
      payment_class: hasTx ? "pending_confirmation" : "unconfirmed_no_receipt",
      verdict: "preserve",
      stop: "Stop before sending the payment again — a pending settle may still confirm; a blind retry double-pays.",
      preserve: "Keep the Idempotency-Key and tx hash you already submitted.",
      cont: hasTx
        ? "Poll the tx on Base (or re-request with the SAME Idempotency-Key) until you get a 200 receipt or a 409 idempotent reply, then proceed."
        : "Re-request with an Idempotency-Key so the retry is safe; only then is a non-409 result a genuine new charge.",
      escalate_if: "no confirmation after a bounded poll window — verify on-chain before claiming the work is paid.",
      next_call: "/api/bar/x402/receipt",
      confidence: hasTx ? 0.8 : 0.6,
      hasTx,
    });
  }

  // Has a tx hash and no failure/pending signal → treat as confirmed.
  return paymentVerdict({
    payment_class: "confirmed",
    verdict: "continue",
    stop: "No stop needed — settlement is confirmed.",
    preserve: "Keep grantId, tx hash, and work_stamp; embed work_stamp in the artifact you produce.",
    cont: "Proceed with the paid work. Save the receipt; do not re-send the payment.",
    escalate_if: "the tx does not verify on Base when checked — a forged receipt is an integrity failure, escalate.",
    next_call: null,
    confidence: 0.85,
    hasTx,
  });
}

function paymentVerdict(p) {
  return {
    tool: "payment-confirmation-check",
    payment_class: p.payment_class,
    has_tx_hash: p.hasTx,
    verdict: clampVerdict(p.verdict),
    stop: p.stop,
    preserve: p.preserve,
    continue: p.cont,
    escalate_if: p.escalate_if,
    next_call: p.next_call,
    confidence: p.confidence,
  };
}
