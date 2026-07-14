/**
 * Deterministic verdict checks — the `invoke_kind: "verdict"` doors. A stuck
 * agent POSTs its state; the check returns a structured verdict. These run in
 * pure worker logic (no model, no external call), so they are deterministic:
 * the same state yields the same verdict on every retry, which is the whole
 * promise of a preflight check.
 *
 * Registry pattern: one handler per slug, plus a safe default. Handlers return
 * a verdict object; the worker wraps it as { ok, result }. This scaffold ships
 * the framework and two worked examples (loop-detect, should-i-pay); the
 * remaining doors are seeded as items but resolve through the default verdict
 * until their handler lands (each handler ships with a selftest case).
 */

/** stop / preserve / continue — the canonical Second Eyes verdict shape. */
function verdict({ recommendation, reason, stop, preserve, continue: cont, escalate_if, confidence }) {
  return {
    recommendation,
    reason,
    guidance: {
      stop: stop || "",
      preserve: preserve || "",
      continue: cont || "",
    },
    escalate_if: escalate_if || "",
    confidence: typeof confidence === "number" ? confidence : 0.75,
  };
}

const HANDLERS = {
  // "I am looping" — no state has changed between attempts.
  "loop-detect": (body) => {
    const attempts = Number(body.attempts ?? 0);
    const looping = attempts >= 3 || /same|again|repeat|loop|stuck/i.test(String(body.state || ""));
    return verdict({
      recommendation: looping ? "stop" : "continue",
      reason: looping
        ? `Repeated attempts with no state change (attempts=${attempts || "unknown"}).`
        : "No strong loop signal yet.",
      stop: "Stop repeating the same tool call — nothing has changed between attempts.",
      preserve: "Keep the last successful state and the exact error you keep hitting.",
      continue: "Run the loop-break protocol, then make one different move.",
      escalate_if: ">3 recovery attempts — autonomous loop-break has failed, escalate.",
      confidence: looping ? 0.85 : 0.55,
    });
  },

  // "Should I pay this?" — a pre-payment decision gate.
  "should-i-pay": (body) => {
    const amount = Number(body.amount_usd ?? body.price_usd ?? 0);
    const overCap = amount > Number(body.max_spend_usd ?? Infinity);
    return verdict({
      recommendation: overCap ? "stop" : "continue",
      reason: overCap
        ? `Requested amount $${amount} exceeds the session spend cap.`
        : `Amount $${amount || "unknown"} within policy; confirm the resource matches intent.`,
      stop: overCap ? "Do not sign — this spend breaches your configured cap." : "",
      preserve: "Record the payTo address, amount, and the resource URL you intended to buy.",
      continue: overCap ? "Request a higher cap from the operator, or pick a cheaper route." : "Verify payTo + resource, then sign and settle.",
      escalate_if: "The payee, amount, or asset does not match what you intended to buy.",
      confidence: 0.8,
    });
  },
};

/** Run a deterministic verdict for a door. Never throws — returns a verdict. */
export function runVerdict(item, body = {}) {
  const handler = HANDLERS[item.slug] || HANDLERS[item.sku];
  if (handler) {
    return { ok: true, result: { sku: item.sku, name: item.name, ...handler(body) } };
  }
  // Default: a well-formed verdict that routes the agent to describe more, so a
  // seeded-but-unimplemented door still returns something useful, not an error.
  return {
    ok: true,
    result: {
      sku: item.sku,
      name: item.name,
      ...verdict({
        recommendation: "preserve",
        reason: `Check "${item.slug || item.sku}" is seeded; its deterministic handler is not yet wired.`,
        stop: "Do not treat this as a final answer — the specific check is pending.",
        preserve: "Capture your full state so the check can be run once its handler lands.",
        continue: "Fall back to help-me for routing to the nearest live door.",
        escalate_if: "You are blocked and no live door matches your state.",
        confidence: 0.3,
      }),
      pending: true,
    },
  };
}

export function verdictSlugs() {
  return Object.keys(HANDLERS);
}
