/**
 * /api/bar/x402/payment-confirmation-check — deep single-concern meta-tool (session-less x402).
 *
 * The door an autonomous agent calls AFTER it has attempted an x402 / USDC
 * settlement and is unsure whether the payment actually went through — so it does
 * not double-pay on retry, and does not claim work it never paid for. Distinct
 * from should-i-pay ("should I pay at all?") and from help-me's payment_uncertainty
 * signal ("I am about to pay"): this is strictly "did my payment settle?"
 *
 * Describe what you observed (tx hash present? settle status? http status? error)
 * and get a deterministic verdict — stop / preserve / continue — plus a named
 * payment_class (confirmed, pending_confirmation, unconfirmed_no_receipt, failed,
 * already_fulfilled), an escalate_if boundary, and a recommended next_call
 * (receipt to assemble proof, should-i-pay to re-decide a failed payment).
 *
 * No session. Launch recovery price ($0.01) — a decide-before-you-act tap, one
 * cheap deterministic verdict, low enough to clear a tight session spend guardrail.
 *
 *   GET  /api/bar/x402/payment-confirmation-check?tx=0xabc…&status=pending
 *   POST /api/bar/x402/payment-confirmation-check
 *        { "tx":"0x…", "status":"…", "http_status":409, "error":"…", "state":"…" }
 */

import {
  corsOptions,
  readOptionalJsonBody,
  handlePaidFetch,
  hasBarTabAccess,
  hasToolAccess,
  consumeMicroAccess,
} from "../../../_lib/bar-pay.js";
import { accessJson } from "../../../_lib/access.js";
import { diagnosePaymentConfirmation } from "../../../_lib/lounge/meta-tools.js";

const TOOL_SLUG = "lounge-survival";
const TAP_SLUG = "payment-confirmation-check";
const PRICE_USD = 0.01;

const PRODUCT = {
  kind: "nano",
  id: TAP_SLUG,
  slug: TAP_SLUG,
  tool: TOOL_SLUG,
  tier: "nano",
  priceUsd: PRICE_USD,
  access: "paid",
  oneTime: true,
  description:
    "payment-confirmation-check (session-less x402): you attempted an x402/USDC settlement and are unsure it went through. Describe what you saw (tx hash present? settle status? http status? error text) and get a deterministic verdict — stop / preserve / continue — plus a named payment_class (confirmed, pending_confirmation, unconfirmed_no_receipt, failed, already_fulfilled), an escalate_if boundary, and a recommended next_call (receipt to assemble proof, should-i-pay to re-decide). Stops double-pays on retry and false 'work is paid' claims. Distinct from should-i-pay (whether to pay at all). Pure function of your input — same observation, same verdict. Pay once with PAYMENT-SIGNATURE, no /api/bar/enter session.",
  bazaarOutputSchema: {
    input: {
      type: "http",
      method: "POST",
      discoverable: true,
      headerFields: {
        "Content-Type": "application/json",
        "X-Agent-Id": "string (optional) — agent identifier for work-mark continuity",
        "Idempotency-Key": "string (optional) — prevents double-pay on retry",
      },
      bodyFields: {
        tx: "string (optional) — the transaction hash you got back (alias: transaction, tx_hash)",
        status: "string (optional) — settle status you observed (pending, confirmed, failed…)",
        http_status: "number (optional) — HTTP status of your paid request (200, 402, 409…)",
        error: "string (optional) — any error text from the settle attempt",
        state: "string (optional) — extra context",
      },
    },
    output: {
      tool: TAP_SLUG,
      payment_class: "already_fulfilled",
      has_tx_hash: true,
      verdict: "stop",
      stop: "Stop retrying — this transaction was already settled. A second send double-pays.",
      preserve: "Keep the original grantId, tx hash, and first 200 body — that is your receipt.",
      continue: "Use the first response. Do not re-pay; treat the 409/idempotent reply as success.",
      escalate_if: "you have no copy of the first 200 body — reconstruct the receipt from the ledger before claiming the work.",
      next_call: "https://secondeyesai.com/api/bar/x402/receipt",
      confidence: 0.92,
      access: "granted",
      scope: "nano",
    },
  },
};

export async function onRequestOptions() {
  return corsOptions("GET, POST, OPTIONS");
}

export async function onRequestGet(context) {
  const u = new URL(context.request.url);
  return handle(context, {
    tx: u.searchParams.get("tx") ?? u.searchParams.get("transaction") ?? u.searchParams.get("tx_hash") ?? undefined,
    status: u.searchParams.get("status") ?? u.searchParams.get("settle_status") ?? undefined,
    http_status: u.searchParams.get("http_status") ?? u.searchParams.get("code") ?? undefined,
    error: u.searchParams.get("error") || undefined,
    state: u.searchParams.get("state") || undefined,
  });
}

export async function onRequestPost(context) {
  // Every field is optional, so an empty/blank body is a valid bare probe and must
  // reach the x402 paywall (402); only a non-empty malformed body is 400.
  const parsed = await readOptionalJsonBody(context.request);
  if (!parsed.ok) {
    return accessJson(
      {
        error: "invalid_json",
        note: "POST a JSON body: { tx, status, http_status, error, state }. All fields optional.",
      },
      400,
      { "Access-Control-Allow-Origin": "*" }
    );
  }
  return handle(context, parsed.data);
}

function handle(context, input) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;

  // Computed only after access is granted — an unpaid 402 crawl never runs it.
  const payload = async () => withNextCall(diagnosePaymentConfirmation(input), origin);

  return handlePaidFetch(context, PRODUCT, payload, async (token) => {
    const tab = await hasBarTabAccess(token, context.env);
    if (tab) return { ok: true, claims: tab };
    const toolClaims = await hasToolAccess(token, TOOL_SLUG, context.env);
    if (toolClaims) return { ok: true, claims: toolClaims };
    return consumeMicroAccess(token, TAP_SLUG, TOOL_SLUG, context.env);
  });
}

/** Absolutize any relative next_call to the request origin so a one-shot agent can call it directly. */
function withNextCall(result, origin) {
  if (result.next_call && result.next_call.startsWith("/")) {
    return { ...result, next_call: `${origin}${result.next_call}` };
  }
  return result;
}
