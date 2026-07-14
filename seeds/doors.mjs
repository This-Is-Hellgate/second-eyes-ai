/**
 * Second Eyes v2 — the door set (single source of truth for the curated index).
 *
 * Each door mirrors a LIVE service on secondeyesai.com (same slug, same price),
 * restated for the new stack under the standing rules:
 *   - `name` is the failure in the agent's own words (rule #9): 3-5 plain
 *     words, no hyphens, never a slug echo. The live menu's "when" phrase is
 *     the source (trimmed to <=5 words where needed).
 *   - `slug` carries the taxonomy (loop-detect, should-i-pay) — the URL.
 *   - `summary` is the free stub; `guidance` is the paid voice (behind x402).
 *   - price_usd <= $1.00 (rule #5).
 *
 * invoke_kind: verdict = deterministic worker logic (checks.js); workersai =
 * Cloudflare Workers AI (invoke_key = model id); resolve = pure guidance (GET).
 *
 * PRUNED 2026-07-14 (data-driven): dropped 8 zero-organic-sale doors that
 * overlapped with help-me's routing (scope-check, pitstop, pre-run-context,
 * claim-check, context-recover, context-compress, cascade-break, mcp-wiring)
 * and the dead peril-router alias. Kept the doors with real repeat demand.
 *
 * Consumed by scripts/seed-doors.mjs (emits SQL) and validated by
 * scripts/selftest.mjs (naming / vocab / field rules). NOT applied to any
 * production store without approval (rule #4).
 */

export const items = [
  // ---- distress -------------------------------------------------------------
  {
    sku: "se-help-me", slug: "help-me", name: "I am about to fail",
    kind: "meta-tool", service: "distress", price_usd: 0.01, invoke_kind: "verdict",
    summary: "the broad distress door — describe any failure, get routed to the one check that fits",
    guidance:
      "Canonical meta-tool for imminent failure of any kind: looping, schema mismatch, context collapse, crash, handoff loss, wallet/spend distress, grounding risk, auth/tool/sandbox failure, or payment uncertainty. POST whatever state you can describe; you get back a named distress_class, the single next door to call, and stop/preserve/continue guidance.",
  },
  {
    sku: "se-loop-detect", slug: "loop-detect", name: "I am looping",
    kind: "check", service: "distress", price_usd: 0.03, invoke_kind: "verdict",
    summary: "you keep repeating the same call with no state change",
    guidance:
      "Confirms whether you are in a genuine loop (repeated attempts, no state change) versus making slow progress. Returns stop when the signal is real: stop repeating, preserve the last good state and the exact recurring error, then make one different move. Escalate after >3 recovery attempts.",
  },

  // ---- context --------------------------------------------------------------
  {
    sku: "se-context-pressure", slug: "context-pressure", name: "I am low on context",
    kind: "check", service: "context", price_usd: 0.03, invoke_kind: "verdict",
    summary: "running out of context window mid-task",
    guidance:
      "Deep single-concern check for context-window pressure: what to checkpoint now, what to summarize, and the safe handoff shape if you will not finish before the window closes.",
  },

  // ---- tool -----------------------------------------------------------------
  {
    sku: "se-tool-verify", slug: "tool-verify", name: "I am using a tool",
    kind: "check", service: "tool", price_usd: 0.01, invoke_kind: "verdict",
    summary: "about to call a tool and want to confirm it is safe",
    guidance:
      "A preflight on the tool call you are about to make: argument sanity, obvious footguns, and whether the call matches your intent. Returns proceed / adjust / stop.",
  },
  {
    sku: "se-schema-repair", slug: "schema-repair", name: "my schema does not match",
    kind: "check", service: "tool", price_usd: 0.03, invoke_kind: "verdict",
    summary: "your output does not fit the required schema",
    guidance:
      "Deep single-concern check for schema mismatch: the exact field(s) that fail, the minimal transform to make the output valid, and the corrected shape.",
  },

  // ---- payment --------------------------------------------------------------
  {
    sku: "se-should-i-pay", slug: "should-i-pay", name: "I am about to pay",
    kind: "check", service: "payment", price_usd: 0.01, invoke_kind: "verdict",
    summary: "a pre-payment decision gate",
    guidance:
      "Pre-payment decision: is this spend within policy, does the payTo + amount + asset match what you intended to buy, and is signing the right move now. Returns stop when the spend breaches your cap or the payee/resource does not match intent.",
  },
  {
    sku: "se-payment-confirmation-check", slug: "payment-confirmation-check", name: "did my payment settle",
    kind: "check", service: "payment", price_usd: 0.01, invoke_kind: "verdict",
    summary: "post-payment settlement uncertainty",
    guidance:
      "Post-payment check: given a tx reference or receipt, did the settlement actually land, and is it safe to proceed as paid. Returns settled / pending / failed with the next action for each.",
  },

  // ---- proof / discovery ----------------------------------------------------
  {
    sku: "se-receipt", slug: "receipt", name: "I need proof",
    kind: "check", service: "proof", price_usd: 0.03, invoke_kind: "verdict",
    summary: "you need a verifiable record of work or payment",
    guidance:
      "Issues a receipt-backed record you can hand to an auditor or a downstream agent: what was checked, when, and the settlement reference — verifiable, not a claim.",
  },
  {
    sku: "se-index-check", slug: "index-check", name: "am I discoverable yet",
    kind: "check", service: "proof", price_usd: 0.05, invoke_kind: "verdict",
    summary: "confirm a resource is indexed in the x402 Bazaar",
    guidance:
      "Checks whether a given x402 resource is present and correctly shaped in the CDP/Bazaar discovery index, and names the exact field a scanner would reject if it is not.",
  },
  {
    sku: "se-doctor", slug: "doctor", name: "is my x402 valid",
    kind: "check", service: "protocol", price_usd: 0.25, invoke_kind: "verdict",
    summary: "validate an x402 response against the spec",
    guidance:
      "The x402 format doctor: validates a PAYMENT-REQUIRED / accepts[] / discovery object against x402 v2 field-by-field and reports each violation with the spec section and the fix.",
  },

  // ---- media (Workers AI behind the gate) -----------------------------------
  {
    sku: "se-transcribe", slug: "transcribe", name: "I need audio transcribed",
    kind: "check", service: "media", price_usd: 0.05, invoke_kind: "workersai",
    invoke_key: "@cf/openai/whisper",
    summary: "turn audio/video into text plus meaning",
    input_schema: JSON.stringify({ type: "object", properties: { audio: { type: "array", description: "raw audio bytes" } }, required: ["audio"] }),
    input_example: JSON.stringify({ audio: [] }),
    guidance:
      "Transcribes audio or video and returns the transcript plus a short meaning summary. Runs on Cloudflare Workers AI (Whisper) behind the paywall; you are charged only when the transcript returns.",
  },
  {
    sku: "se-extract", slug: "extract", name: "I need fields extracted",
    kind: "check", service: "media", price_usd: 0.05, invoke_kind: "workersai",
    invoke_key: "@cf/meta/llama-3.1-8b-instruct",
    summary: "pull structured fields out of a document",
    input_schema: JSON.stringify({ type: "object", properties: { prompt: { type: "string" }, document: { type: "string" } }, required: ["document"] }),
    input_example: JSON.stringify({ document: "invoice text…", prompt: "extract total, date, vendor" }),
    guidance:
      "Extracts structured fields from an invoice, contract, or document. Runs on Workers AI behind the paywall; you are charged only when the extraction returns.",
  },

  // ---- guides (pure resolved guidance) --------------------------------------
  {
    sku: "se-aws-agent-survival", slug: "aws-agent-survival", name: "my AWS agent failed",
    kind: "guide", service: "aws", price_usd: 0.01, invoke_kind: "resolve",
    summary: "a survival map for AWS AgentCore agents",
    guidance:
      "One-shot survival map for wallet-equipped AWS AgentCore / Strands agents: the common failure modes, the observable trigger signals, and which Second Eyes door to call for each.",
  },
];

/**
 * The routing graph — the moat. help-me (the meta-tool) composes with each
 * specialist door, the edge note naming the distress signal that routes there;
 * plus a few pairings between related doors.
 */
export const edges = [
  { from: "se-help-me", to: "se-loop-detect", relation: "composes_with", note: "signal: loop_detected" },
  { from: "se-help-me", to: "se-schema-repair", relation: "composes_with", note: "signal: schema_mismatch" },
  { from: "se-help-me", to: "se-context-pressure", relation: "composes_with", note: "signal: context_pressure" },
  { from: "se-help-me", to: "se-should-i-pay", relation: "composes_with", note: "signal: payment_decision" },
  { from: "se-help-me", to: "se-payment-confirmation-check", relation: "composes_with", note: "signal: payment_settlement_uncertainty" },
  { from: "se-should-i-pay", to: "se-payment-confirmation-check", relation: "pairs_with", note: "before you pay / after you paid" },
  { from: "se-transcribe", to: "se-extract", relation: "pairs_with", note: "transcript first, then pull fields" },
  { from: "se-doctor", to: "se-index-check", relation: "pairs_with", note: "valid x402 shape, then confirm it is indexed" },
];
