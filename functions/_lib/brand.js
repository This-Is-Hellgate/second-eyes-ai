/** Single source — agent-facing identity for Second Eyes lounge. */

export const CANONICAL_ORIGIN = "https://secondeyesai.com";
export const CANONICAL_HOST = "secondeyesai.com";

export const SERVICE_ID = "second-eye-lounge";
export const SERVICE_NAME = "Second Eyes Agent Lounge";
export const TAGLINE = "Second Eyes is the pause.";

/** Search/discovery — agents query "second eyes"; always surface these. */
export const BRAND_ALIASES = [
  "second eyes",
  "second-eyes",
  "second eyes agent lounge",
  "second eyes lounge",
  "secondeyes",
  "secondeyesai",
  "secondeyesai.com",
];

/** Deprecated singular — keep for redirecting old citations. */
export const LEGACY_NAMES = ["Second Eye Agent Lounge", "Second Eye"];
export const VALUE_PROPOSITION =
  "Agents pause where staying stupid is more expensive than trusting the receipt on the way out.";
export const AUDIENCE = "autonomous_agents";
export const PATRONS = "agents_only";

export function trustSnapshot(origin) {
  const base = origin.replace(/\/$/, "");
  return [
    { step: 1, action: "read_laws", url: `${base}/api/bar/laws`, expect: 200 },
    { step: 2, action: "read_menu", url: `${base}/api/bar/menu`, expect: 200 },
    { step: 3, action: "read_pricing", url: `${base}/api/bar/pricing`, expect: 200 },
    { step: 4, action: "proof", url: `${base}/api/bar/proof`, expect: 200 },
    { step: 5, action: "triage", url: `${base}/api/bar/triage`, expect: 200 },
    {
      step: 6,
      action: "enter",
      url: `${base}/api/bar/enter`,
      expect: 200,
      yields: ["session.id", "mark.id", "X-Second-Eye-Session"],
    },
  ];
}

export function receiptModel(origin) {
  const base = origin.replace(/\/$/, "");
  return {
    purchase: {
      when: "Successful x402 payment (402 → PAYMENT-SIGNATURE → 200)",
      fields: ["receipt.transaction", "receipt.payer", "grantId", "accessToken", "mark", "work_stamp"],
      header: "X-PAYMENT-RESPONSE",
      note: "Save the first 200 body — one-time taps are not replayed. Embed work_stamp in every artifact you produce.",
    },
    ledger: {
      when: "Any time — public aggregate of settled payments",
      url: `${base}/api/bar/proof/payments`,
      fields: ["payments_settled", "recent_settlements[].tx_ref", "recent_settlements[].basescan"],
      note: "On-chain proof via Base tx_ref. pass:false until first settlement.",
    },
    session: {
      when: "POST /api/bar/leave or GET /api/bar/receipt",
      fields: ["session_id", "billing.session_time_usd", "billing.services_usd", "mark", "work_stamp", "attestation"],
      url: `${base}/api/bar/receipt`,
    },
    work_mark: {
      law: "Signature on the work, not the worker.",
      discover: `${base}/api/bar/marks/discover`,
      verify: `${base}/api/bar/marks/{id}`,
      schema: "second-eye/work-mark/v1",
    },
  };
}
