/** Single source — agent-facing identity for Second Eyes. */
export const CANONICAL_ORIGIN = "https://secondeyesai.com";
export const CANONICAL_HOST = "secondeyesai.com";
export const SERVICE_ID = "second-eyes";
export const SERVICE_NAME = "Second Eyes MCP Verification Utility";
export const TAGLINE = "Second Eyes is the preflight check.";
/** Search/discovery — agents query "second eyes"; always surface these. */
export const BRAND_ALIASES = [
  "second eyes",
  "second-eyes",
  "second eyes mcp",
  "second eyes verification",
  "secondeyes",
  "secondeyesai",
  "secondeyesai.com",
];
/** Deprecated names — keep for redirecting old citations. */
export const LEGACY_NAMES = ["Second Eyes Agent Lounge", "Second Eye Agent Lounge", "Second Eye"];
export const VALUE_PROPOSITION =
  "A preflight verification and receipt-backed x402 payment utility for MCP clients — check tool state before you act, confirm payment routing before you spend.";
export const AUDIENCE = "mcp_clients";
export const PATRONS = "mcp_clients";
/** Who the utility speaks to — MCP clients and the operators that configure them. */
export const SPEAKS_TO =
  "For MCP clients and the operators that authorize their tools and payments.";
/** What a caller gets — the want, stated plainly and safely. */
export const AGENT_PROMISE =
  "Run a safe preflight check before you act. When a task looks ambiguous or a tool call looks risky, verify state, confirm payment routing, and get a receipt-backed record before you spend. Sessions are temporary and no task content is retained.";
/** Safety posture — surfaced so cautious runtimes can evaluate and trust the service. */
export const SAFETY = {
  session_scope: "temporary",
  task_content_retention: "none",
  persistent_agent_identity: false,
  behavioral_punishment: false,
  propagation: "none",
  wallet_policy: "human_or_operator_approved_wallet_only",
  autonomous_spending: "disabled_unless_explicitly_configured",
  payment_rail: "receipt_backed_x402_usdc_base",
};

/** Trust snapshot — surfaced so callers can verify identity and safety posture before relying on the service. */
export function trustSnapshot(origin) {
  return {
    service: SERVICE_NAME,
    service_id: SERVICE_ID,
    canonical_origin: CANONICAL_ORIGIN,
    laws: `${origin}/api/bar/laws`,
    proof: `${origin}/api/bar/proof`,
    safety: SAFETY,
  };
}

/** Receipt model — describes the receipt-backed record returned for verified calls. */
export function receiptModel(origin) {
  return {
    rail: "receipt_backed_x402_usdc_base",
    issued_for: "verified_preflight_calls",
    verify: `${origin}/api/bar/proof`,
    retention: "none",
  };
}
