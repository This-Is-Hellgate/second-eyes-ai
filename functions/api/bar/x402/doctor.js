/**
 * /api/bar/x402/doctor ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â x402 / Coinbase survival bar, flagship tap.
 *
 * Grades any x402 "402 Payment Required" response for CDP Bazaar v2 indexing
 * compliance and returns the exact corrected payload. No session required ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â a
 * clean discover ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ pay ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ use tap so it settles and indexes on the Bazaar.
 *
 * Input (after payment):
 *   GET  /api/bar/x402/doctor?url=https://target/endpoint   ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ we fetch its 402
 *   POST /api/bar/x402/doctor  { "url": "https://ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦" }        ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ we fetch its 402
 *   POST /api/bar/x402/doctor  { "body": { ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦402 jsonÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ } }    ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ grade a pasted body
 */

import { diagnose402 } from "../../../_lib/x402-doctor.js";
import {
  corsOptions,
  handlePaidFetch,
  hasBarTabAccess,
  hasToolAccess,
  consumeMicroAccess,
  bearerToken,
  completePaidNanoDelivery,
  paymentVerifyFailureResponse,
} from "../../../_lib/bar-pay.js";
import { accessJson } from "../../../_lib/access.js";
import { fetchWithTimeout, DEFAULT_FETCH_TIMEOUT_MS } from "../../../_lib/resilience.js";
import { isSafeHttpUrl } from "../../../_lib/url-guard.js";
import { recordX402PaymentAttempt, readRequestId } from "../../../_lib/x402-payment-log.js";
import { buildProductPaymentRequirements, readPaymentHeader, settleBuiltPayment, verifyPaymentHeader } from "../../../_lib/x402.js";

const TOOL_SLUG = "x402-survival";
const TAP_SLUG = "x402-doctor";
const PRICE_USD = 0.25;

const PRODUCT = {
  kind: "micro",
  id: TAP_SLUG,
  slug: TAP_SLUG,
  tool: TOOL_SLUG,
  tier: "micro",
  priceUsd: PRICE_USD,
  access: "paid",
  oneTime: true,
  description:
    "x402-doctor: grade any x402 402 response for CDP Bazaar v2 indexing compliance and return the exact corrected payload.",
  bazaarOutputSchema: {
    input: {
      type: "http",
      method: "GET",
    },
    output: {
      tool: TAP_SLUG,
      version: 1,
      score: 42,
      grade: "F",
      indexable: false,
      criticalCount: 3,
      summary: "This is x402 v1 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â it will not index on the Bazaar. Apply the corrected payload, redeploy, then settle one payment.",
      corrected: { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453" }] },
    },
  },
};

export async function onRequestOptions() {
  return corsOptions("GET, POST, OPTIONS");
}

export async function onRequestGet(context) {
  return handle(context, parseGetInput(context.request));
}

export async function onRequestPost(context) {
  let input;
  try {
    input = await parsePostInput(context.request);
  } catch {
    return accessJson(
      { error: "invalid_json", note: "POST a JSON body: { url } or { body }." },
      400,
      { "Access-Control-Allow-Origin": "*" }
    );
  }
  return handle(context, input);
}

function parseGetInput(request) {
  const u = new URL(request.url);
  return { url: u.searchParams.get("url") || null, body: null };
}

async function parsePostInput(request) {
  // Read the raw body once and treat empty/blank as a bare probe regardless of the
  // declared content-type, so an empty POST (even with Content-Type: application/json)
  // reaches the x402 paywall via no_input rather than 400ing on request.json().
  const raw = (await request.text()).trim();
  if (!raw) return { url: null, body: null };
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    return { url: null, body: JSON.parse(raw) };
  }
  const data = JSON.parse(raw);
  if (typeof data?.body === "string") {
    return { url: data.url || null, body: JSON.parse(data.body) };
  }
  return { url: data?.url || null, body: data?.body ?? null };
}

async function peekAccess(token, env) {
  const tab = await hasBarTabAccess(token, env);
  if (tab) return { ok: true, claims: tab };
  return hasToolAccess(token, TOOL_SLUG, env);
}

async function handle(context, input) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;
  const paymentHeader = readPaymentHeader(request);
  const token = bearerToken(request);

  const credible = paymentHeader || (token && (await peekAccess(token, env)));
  if (!credible) {
    return handlePaidFetch(context, PRODUCT, async () => ({}), async (t) => {
      const tab = await hasBarTabAccess(t, env);
      if (tab) return { ok: true, claims: tab };
      const toolClaims = await hasToolAccess(t, TOOL_SLUG, env);
      if (toolClaims) return { ok: true, claims: toolClaims };
      return consumeMicroAccess(t, TAP_SLUG, TOOL_SLUG, env);
    });
  }

  let verifiedPayment = null;
  if (paymentHeader) {
    const requirements = buildProductPaymentRequirements(PRODUCT, request.url, env);
    if (!requirements) {
      return accessJson(
        { error: "x402_not_configured", product: PRODUCT.id, priceUsd: PRODUCT.priceUsd, hint: "Set X402_PAYTO and X402_FACILITATOR_URL" },
        503,
        { "Access-Control-Allow-Origin": "*" }
      );
    }
    verifiedPayment = await verifyPaymentHeader(paymentHeader, requirements, env);
    if (!verifiedPayment.ok) {
      await recordX402PaymentAttempt(env, paymentHeader, { route: new URL(request.url).pathname, requestId: readRequestId(request) }, verifiedPayment, null);
      return paymentVerifyFailureResponse(context, PRODUCT, requirements, verifiedPayment, origin);
    }
  }

  // Run the diagnosis BEFORE settling. diagnose402's real output never sets `error`;
  // only input-side problems (no_input, unsafe_url, fetch_failed, target_not_json) do.
  // If we cannot deliver a real diagnosis, we do not charge for it.
  const report = await runDiagnosis(input);
  if (report.error) {
    if (verifiedPayment && paymentHeader) {
      await recordX402PaymentAttempt(env, paymentHeader, { route: new URL(request.url).pathname, failure_reason: report.error, requestId: readRequestId(request) }, verifiedPayment, null);
    }
    return accessJson(
      { ...report, settled: false, charged: false, note: (report.note || "") + " Not charged: no diagnosis was produced." },
      422,
      { "Access-Control-Allow-Origin": "*" }
    );
  }

  if (verifiedPayment) {
    const settled = await settleBuiltPayment(verifiedPayment.built, verifiedPayment.accept, env);
    await recordX402PaymentAttempt(env, paymentHeader, { route: new URL(request.url).pathname, requestId: readRequestId(request) }, verifiedPayment, settled);
    if (!settled.ok) {
      return paymentVerifyFailureResponse(context, PRODUCT, verifiedPayment.requirement, settled, origin);
    }
    return completePaidNanoDelivery(context, PRODUCT, report, settled);
  }

  return handlePaidFetch(context, PRODUCT, async () => report, async (t) => {
    const tab = await hasBarTabAccess(t, env);
    if (tab) return { ok: true, claims: tab };
    const toolClaims = await hasToolAccess(t, TOOL_SLUG, env);
    if (toolClaims) return { ok: true, claims: toolClaims };
    return consumeMicroAccess(t, TAP_SLUG, TOOL_SLUG, env);
  });
}
async function runDiagnosis(input) {
  if (!input.url && !input.body) {
    return {
      tool: TAP_SLUG,
      error: "no_input",
      note: "Provide a target to diagnose.",
      usage: {
        fetch_live: "GET /api/bar/x402/doctor?url=https://your-host/your/endpoint",
        paste_body: 'POST /api/bar/x402/doctor  { "body": { ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦your 402 jsonÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ } }',
      },
    };
  }

  if (input.url) {
    if (!isSafeHttpUrl(input.url)) {
      return {
        tool: TAP_SLUG,
        error: "unsafe_url",
        note: "Target must be an absolute https URL on a public host.",
        provided: input.url,
      };
    }
    let res;
    try {
      res = await fetchWithTimeout(
        input.url,
        { method: "GET", headers: { Accept: "application/json" } },
        DEFAULT_FETCH_TIMEOUT_MS
      );
    } catch {
      return { tool: TAP_SLUG, error: "fetch_failed", note: "Could not reach the target URL.", provided: input.url };
    }
    const text = await res.text();
    let body402;
    try {
      body402 = JSON.parse(text);
    } catch {
      return {
        tool: TAP_SLUG,
        error: "target_not_json",
        note: "The target did not return a JSON body to diagnose. A compliant endpoint returns HTTP 402 with a JSON payment-required body.",
        fetched: { status: res.status, contentType: res.headers.get("content-type") },
        raw: text.slice(0, 500),
      };
    }
    const report = diagnose402(body402, { sourceUrl: input.url });
    report.fetched = {
      url: input.url,
      status: res.status,
      was_402: res.status === 402,
      contentType: res.headers.get("content-type"),
    };
    if (res.status !== 402) {
      report.checks.unshift({
        id: "http_402",
        label: "Endpoint returns HTTP 402 on bare request",
        severity: "critical",
        status: "fail",
        detail: `Target returned HTTP ${res.status}, not 402. The CDP crawler must receive 402 on an unauthenticated request, or it cannot index the service.`,
        fix: "Return status 402 with the payment-required JSON body before any session/auth gate.",
      });
      report.indexable = false;
      report.summary = "Endpoint does not return 402 on a bare request. " + report.summary;
    }
    return report;
  }

  return diagnose402(input.body, {});
}
