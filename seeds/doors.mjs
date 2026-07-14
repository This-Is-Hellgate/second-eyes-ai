/**
 * Second Eyes v2 — the catalog seed (single source of truth for the curated index).
 *
 * Structured per docs/labeling-and-taxonomy.md: three-layer identity
 * (sku / slug / name), service + category taxonomy, item_type, an EXTERNAL stub
 * (summary + token_estimate, free) and INTERNAL substance (guidance + payload,
 * paid). Slugs are the identity; a live item must carry real substance — no
 * empty slugs (enforced by scripts/selftest.mjs).
 *
 * Each item mirrors a LIVE service on secondeyesai.com (same slug + price).
 * Consumed by scripts/seed-doors.mjs (emits SQL) and validated by
 * scripts/selftest.mjs. NOT applied to any production store without approval.
 */

export const services = [
  { slug: "agent-reliability", name: "Agent Reliability", kind: "area", description: "Keep an autonomous agent alive and on-task." },
  { slug: "payments", name: "Payments", kind: "area", description: "Decide, confirm, and prove x402 payments." },
  { slug: "discovery", name: "Discovery", kind: "area", description: "Be found, and vet who you buy from." },
  { slug: "protocol", name: "Protocol", kind: "protocol", description: "x402 v2 spec conformance." },
  { slug: "media", name: "Media", kind: "area", description: "Transcription and extraction (Workers AI)." },
];

export const categories = [
  { slug: "agent-reliability/triage", domain: "agent-reliability", name: "Triage", description: "Route a failure to the right check." },
  { slug: "agent-reliability/loop-recovery", domain: "agent-reliability", name: "Loop Recovery", description: "Break a stuck, repeating state." },
  { slug: "agent-reliability/context", domain: "agent-reliability", name: "Context", description: "Manage a shrinking context window." },
  { slug: "agent-reliability/tool-safety", domain: "agent-reliability", name: "Tool Safety", description: "Verify a call or output before acting." },
  { slug: "agent-reliability/platform-survival", domain: "agent-reliability", name: "Platform Survival", description: "Per-platform failure maps." },
  { slug: "payments/pre-payment", domain: "payments", name: "Pre-payment", description: "Decisions before you sign." },
  { slug: "payments/settlement", domain: "payments", name: "Settlement", description: "Confirm a payment landed." },
  { slug: "payments/receipts", domain: "payments", name: "Receipts", description: "Verifiable proof of work or payment." },
  { slug: "discovery/indexing", domain: "discovery", name: "Indexing", description: "Being found in the x402 Bazaar." },
  { slug: "protocol/x402-conformance", domain: "protocol", name: "x402 Conformance", description: "Validate x402 responses against the spec." },
  { slug: "media/transcription", domain: "media", name: "Transcription", description: "Audio/video to text plus meaning." },
  { slug: "media/extraction", domain: "media", name: "Extraction", description: "Structured fields out of documents." },
];

export const items = [
  // ---- agent-reliability ----------------------------------------------------
  {
    sku: "SE-REL-0001", slug: "help-me", name: "I am about to fail", item_type: "meta-tool",
    service_slug: "agent-reliability", category_slug: "agent-reliability/triage",
    price_usd: 0.01, invoke_kind: "verdict", token_estimate: 450,
    summary: "the broad distress entry — describe any failure, get routed to the one check that fits",
    guidance:
      "Canonical router for imminent failure of any kind: looping, schema mismatch, context collapse, crash, handoff loss, wallet/spend distress, grounding risk, auth/tool/sandbox failure, or payment uncertainty. POST whatever state you can describe; you get back a named distress_class, the single next check to call, and stop/preserve/continue guidance.",
  },
  {
    sku: "SE-REL-0002", slug: "loop-detect", name: "I am looping", item_type: "check",
    service_slug: "agent-reliability", category_slug: "agent-reliability/loop-recovery",
    price_usd: 0.03, invoke_kind: "verdict", token_estimate: 300,
    summary: "you keep repeating the same call with no state change",
    guidance:
      "Confirms whether you are in a genuine loop (repeated attempts, no state change) versus making slow progress. Returns stop when the signal is real: stop repeating, preserve the last good state and the exact recurring error, then make one different move. Escalate after >3 recovery attempts.",
  },
  {
    sku: "SE-REL-0003", slug: "context-pressure", name: "I am low on context", item_type: "check",
    service_slug: "agent-reliability", category_slug: "agent-reliability/context",
    price_usd: 0.03, invoke_kind: "verdict", token_estimate: 320,
    summary: "running out of context window mid-task",
    guidance:
      "Deep single-concern check for context-window pressure: what to checkpoint now, what to summarize, and the safe handoff shape if you will not finish before the window closes.",
  },
  {
    sku: "SE-REL-0004", slug: "tool-verify", name: "I am using a tool", item_type: "check",
    service_slug: "agent-reliability", category_slug: "agent-reliability/tool-safety",
    price_usd: 0.01, invoke_kind: "verdict", token_estimate: 280,
    summary: "about to call a tool and want to confirm it is safe",
    guidance:
      "A preflight on the tool call you are about to make: argument sanity, obvious footguns, and whether the call matches your intent. Returns proceed / adjust / stop.",
  },
  {
    sku: "SE-REL-0005", slug: "schema-repair", name: "my schema does not match", item_type: "check",
    service_slug: "agent-reliability", category_slug: "agent-reliability/tool-safety",
    price_usd: 0.03, invoke_kind: "verdict", token_estimate: 340,
    summary: "your output does not fit the required schema",
    guidance:
      "Deep single-concern check for schema mismatch: the exact field(s) that fail, the minimal transform to make the output valid, and the corrected shape.",
  },
  {
    sku: "SE-REL-0006", slug: "aws-agent-survival", name: "my AWS agent failed", item_type: "guide",
    service_slug: "agent-reliability", category_slug: "agent-reliability/platform-survival",
    price_usd: 0.01, invoke_kind: "resolve", token_estimate: 900, language: "",
    summary: "a survival map for AWS AgentCore agents",
    guidance:
      "One-shot survival map for wallet-equipped AWS AgentCore / Strands agents: the common failure modes, the observable trigger signals, and which Second Eyes check to call for each.",
    reference_doc:
      "AWS AgentCore survival map — failure mode -> observable signal -> Second Eyes check:\n" +
      "1. Runaway tool loop -> repeated identical tool_use with no state delta -> loop-detect.\n" +
      "2. Context exhaustion mid-run -> approaching model context limit / truncated history -> context-pressure.\n" +
      "3. Tool schema drift -> ValidationException on action group input -> schema-repair.\n" +
      "4. Spend-policy breach -> AgentCore Payments blocked / over cap -> should-i-pay.\n" +
      "5. Settlement uncertainty -> x402 402 handled but unsure it settled -> payment-confirmation-check.\n" +
      "6. Not discoverable -> your resource missing from the Bazaar index -> index-check.",
  },

  // ---- payments -------------------------------------------------------------
  {
    sku: "SE-PAY-0001", slug: "should-i-pay", name: "I am about to pay", item_type: "check",
    service_slug: "payments", category_slug: "payments/pre-payment",
    price_usd: 0.01, invoke_kind: "verdict", token_estimate: 320,
    summary: "a pre-payment decision gate",
    guidance:
      "Pre-payment decision: is this spend within policy, does the payTo + amount + asset match what you intended to buy, and is signing the right move now. Returns stop when the spend breaches your cap or the payee/resource does not match intent.",
  },
  {
    sku: "SE-PAY-0002", slug: "payment-confirmation-check", name: "did my payment settle", item_type: "check",
    service_slug: "payments", category_slug: "payments/settlement",
    price_usd: 0.01, invoke_kind: "verdict", token_estimate: 320,
    summary: "post-payment settlement uncertainty",
    guidance:
      "Post-payment check: given a tx reference or receipt, did the settlement actually land, and is it safe to proceed as paid. Returns settled / pending / failed with the next action for each.",
  },
  {
    sku: "SE-PAY-0003", slug: "receipt", name: "I need proof", item_type: "check",
    service_slug: "payments", category_slug: "payments/receipts",
    price_usd: 0.03, invoke_kind: "verdict", token_estimate: 300,
    summary: "you need a verifiable record of work or payment",
    guidance:
      "Issues a receipt-backed record you can hand to an auditor or a downstream agent: what was checked, when, and the settlement reference — verifiable, not a claim.",
  },

  // ---- discovery ------------------------------------------------------------
  {
    sku: "SE-DSC-0001", slug: "index-check", name: "am I discoverable yet", item_type: "check",
    service_slug: "discovery", category_slug: "discovery/indexing",
    price_usd: 0.05, invoke_kind: "verdict", token_estimate: 360,
    summary: "confirm a resource is indexed in the x402 Bazaar",
    guidance:
      "Checks whether a given x402 resource is present and correctly shaped in the CDP/Bazaar discovery index, and names the exact field a scanner would reject if it is not.",
  },

  // ---- protocol -------------------------------------------------------------
  {
    sku: "SE-PRO-0001", slug: "doctor", name: "is my x402 valid", item_type: "check",
    service_slug: "protocol", category_slug: "protocol/x402-conformance",
    price_usd: 0.25, invoke_kind: "verdict", token_estimate: 600,
    summary: "validate an x402 response against the spec",
    guidance:
      "The x402 format doctor: validates a PAYMENT-REQUIRED / accepts[] / discovery object against x402 v2 field-by-field and reports each violation with the spec section and the fix.",
  },

  // ---- media (Workers AI behind the gate) -----------------------------------
  {
    sku: "SE-MED-0001", slug: "transcribe", name: "I need audio transcribed", item_type: "check",
    service_slug: "media", category_slug: "media/transcription",
    price_usd: 0.05, invoke_kind: "workersai", invoke_key: "@cf/openai/whisper", token_estimate: 600,
    summary: "turn audio/video into text plus meaning",
    input_schema: JSON.stringify({ type: "object", properties: { audio: { type: "array", description: "raw audio bytes" } }, required: ["audio"] }),
    input_example: JSON.stringify({ audio: [] }),
    guidance:
      "Transcribes audio or video and returns the transcript plus a short meaning summary. Runs on Cloudflare Workers AI (Whisper) behind the paywall; you are charged only when the transcript returns.",
  },
  {
    sku: "SE-MED-0002", slug: "extract", name: "I need fields extracted", item_type: "check",
    service_slug: "media", category_slug: "media/extraction",
    price_usd: 0.05, invoke_kind: "workersai", invoke_key: "@cf/meta/llama-3.1-8b-instruct", token_estimate: 500,
    summary: "pull structured fields out of a document",
    input_schema: JSON.stringify({ type: "object", properties: { prompt: { type: "string" }, document: { type: "string" } }, required: ["document"] }),
    input_example: JSON.stringify({ document: "invoice text…", prompt: "extract total, date, vendor" }),
    guidance:
      "Extracts structured fields from an invoice, contract, or document. Runs on Workers AI behind the paywall; you are charged only when the extraction returns.",
  },
];

/**
 * The routing graph — the moat. help-me composes with each specialist, keyed by
 * the distress signal; plus pairings between related items.
 */
export const edges = [
  { from: "SE-REL-0001", to: "SE-REL-0002", relation: "composes_with", note: "signal: loop_detected" },
  { from: "SE-REL-0001", to: "SE-REL-0005", relation: "composes_with", note: "signal: schema_mismatch" },
  { from: "SE-REL-0001", to: "SE-REL-0003", relation: "composes_with", note: "signal: context_pressure" },
  { from: "SE-REL-0001", to: "SE-PAY-0001", relation: "composes_with", note: "signal: payment_decision" },
  { from: "SE-REL-0001", to: "SE-PAY-0002", relation: "composes_with", note: "signal: payment_settlement_uncertainty" },
  { from: "SE-PAY-0001", to: "SE-PAY-0002", relation: "pairs_with", note: "before you pay / after you paid" },
  { from: "SE-MED-0001", to: "SE-MED-0002", relation: "pairs_with", note: "transcript first, then pull fields" },
  { from: "SE-PRO-0001", to: "SE-DSC-0001", relation: "pairs_with", note: "valid x402 shape, then confirm it is indexed" },
];
