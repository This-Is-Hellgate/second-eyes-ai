/**
 * /api/bar/x402/extract — document-intelligence door (session-less x402 sibling
 * of the transcription door).
 *
 * Give it a PDF/doc URL and a doc_type; it pulls the bytes (SSRF-guarded), hands
 * the file to Gemini for structured extraction, then runs doc-validate.js — a
 * deterministic gate (strict schema + arithmetic reconciliation + date/currency
 * sanity + required fields). We charge and mint a work-mark ONLY when the
 * extraction reconciles. On an arithmetic/schema failure we return the exact
 * discrepancy and DO NOT settle — the buyer is not charged for an extraction we
 * cannot stand behind.
 *
 *   GET  /api/bar/x402/extract?url=https://host/doc.pdf&doc_type=invoice
 *   POST /api/bar/x402/extract  { "url": "https://…", "doc_type": "invoice" }
 *
 * Attestation is EVIDENCE-ONLY: "schema-valid, totals reconcile, dates parse,
 * currency is ISO-4217" — never "legally verified" and never legal/financial
 * advice. We did not read the document for meaning; we measured its structure.
 */

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
import { accessJson, verifyAccessToken } from "../../../_lib/access.js";
import { fetchWithTimeout } from "../../../_lib/resilience.js";
import { isSafeHttpUrl } from "../../../_lib/url-guard.js";
import { callGemini } from "../../../_lib/llm-openrouter.js";
import { validateDoc, DOC_SCHEMAS, DOC_TYPES } from "../../../_lib/doc-validate.js";
import { recordX402PaymentAttempt } from "../../../_lib/x402-payment-log.js";
import {
  buildProductPaymentRequirements,
  readPaymentHeader,
  settleBuiltPayment,
  verifyPaymentHeader,
} from "../../../_lib/x402.js";

const TOOL_SLUG = "doc-intelligence";
const TAP_SLUG = "doc-extract";
const PRICE_USD = 0.05;

/** Document fetch + multimodal extraction run longer than the 5s default rail. */
const DOC_FETCH_TIMEOUT_MS = 15_000;
/** Hard ceiling on bytes we will base64-encode and forward to the model. */
const MAX_DOC_BYTES = 15 * 1024 * 1024;

const CORS = { "Access-Control-Allow-Origin": "*" };

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
    "doc-extract: structured, arithmetic-reconciled extraction of an invoice, contract, or generic document from a PDF/doc URL. Evidence-only (schema-valid, totals reconcile, dates parse, ISO-4217 currency). Charges only when the extraction reconciles; on a math/schema failure it returns the discrepancy and does not settle.",
  bazaarOutputSchema: {
    input: { type: "http", method: "GET" },
    output: {
      tool: TAP_SLUG,
      doc_type: "invoice",
      validated: true,
      data: {
        vendor: "Acme LLC",
        buyer: "Globex Inc",
        line_items: [{ desc: "Widget", qty: 2, unit_price: 10, amount: 20 }],
        subtotal: 20,
        tax: 1.6,
        total: 21.6,
        currency: "USD",
        dates: { issue_date: "2026-01-15", due_date: "2026-02-14" },
      },
      attestation: {
        basis: "evidence-only",
        claims: ["schema-valid structured output", "line items sum to subtotal", "subtotal + tax reconciles to total"],
      },
    },
  },
};

export async function onRequestOptions() {
  return corsOptions("GET, POST, OPTIONS");
}

export async function onRequestGet(context) {
  const u = new URL(context.request.url);
  return handle(context, {
    url: u.searchParams.get("url") || null,
    docType: normalizeDocType(u.searchParams.get("doc_type")),
  });
}

export async function onRequestPost(context) {
  let input;
  try {
    const data = await context.request.json();
    input = { url: data?.url || null, docType: normalizeDocType(data?.doc_type) };
  } catch {
    return accessJson(
      { error: "invalid_json", note: 'POST a JSON body: { "url": "https://…", "doc_type": "invoice|contract|generic" }.' },
      400,
      CORS
    );
  }
  return handle(context, input);
}

function normalizeDocType(v) {
  return typeof v === "string" ? v.trim().toLowerCase() : "generic";
}

/** Standard tab → tool → one-time nano consumption check (mirrors the other x402 doors). */
function accessCheck(token, env) {
  return (async () => {
    const tab = await hasBarTabAccess(token, env);
    if (tab) return { ok: true, claims: tab };
    const toolClaims = await hasToolAccess(token, TOOL_SLUG, env);
    if (toolClaims) return { ok: true, claims: toolClaims };
    return consumeMicroAccess(token, TAP_SLUG, TOOL_SLUG, env);
  })();
}

/** Non-consuming look: could this token access the door? Used to gate model spend. */
async function peekAccess(token, env) {
  const claims = await verifyAccessToken(token, env);
  if (!claims) return false;
  if (claims.scope === "bar_tab") return true;
  if (claims.scope === "tool" && claims.tool === TOOL_SLUG) return true;
  if ((claims.scope === "nano" || claims.scope === "micro") && claims.tap === TAP_SLUG) return true;
  return false;
}

async function handle(context, input) {
  const { request, env } = context;
  const paymentHeader = readPaymentHeader(request);
  const token = bearerToken(request);
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;

  // Bare / unauthenticated request → standard x402 paywall (402). No model work,
  // no outbound fetch. The CDP Bazaar crawler must receive 402 on a bare GET to
  // index this route, so the paywall has to run before anything else.
  const credible = paymentHeader || (token && (await peekAccess(token, env)));
  if (!credible) {
    return handlePaidFetch(context, PRODUCT, async () => ({}), (t) => accessCheck(t, env));
  }

  let verifiedPayment = null;
  if (paymentHeader) {
    const requirements = buildProductPaymentRequirements(PRODUCT, request.url, env);
    if (!requirements) {
      return accessJson(
        {
          error: "x402_not_configured",
          product: PRODUCT.id,
          priceUsd: PRODUCT.priceUsd,
          hint: "Set X402_PAYTO and X402_FACILITATOR_URL",
        },
        503,
        CORS
      );
    }
    verifiedPayment = await verifyPaymentHeader(paymentHeader, requirements, env);
    if (!verifiedPayment.ok) {
      await recordX402PaymentAttempt(
        env,
        paymentHeader,
        { route: new URL(request.url).pathname },
        verifiedPayment,
        null
      );
      return paymentVerifyFailureResponse(context, PRODUCT, requirements, verifiedPayment, origin);
    }
  }

  // Cheap input validation — never charge for malformed input or an unsafe URL.
  if (!input.url) {
    return accessJson(
      { tool: TAP_SLUG, error: "no_input", note: "Provide ?url= (or { url }) pointing to a PDF/doc.", doc_types: DOC_TYPES },
      400,
      CORS
    );
  }
  if (!DOC_TYPES.includes(input.docType)) {
    return accessJson(
      { tool: TAP_SLUG, error: "bad_doc_type", provided: input.docType, allowed: DOC_TYPES },
      400,
      CORS
    );
  }
  if (!isSafeHttpUrl(input.url)) {
    return accessJson(
      { tool: TAP_SLUG, error: "unsafe_url", note: "url must be an absolute https URL on a public host.", provided: input.url },
      400,
      CORS
    );
  }

  // Extract + deterministically validate BEFORE any settlement.
  const extracted = await extractDocument(env, input);
  if (!extracted.ok) {
    // Our failure (fetch/model) — do not charge. Surface a stable code.
    return accessJson({ tool: TAP_SLUG, doc_type: input.docType, ...extracted.body }, extracted.status, CORS);
  }

  const verdict = validateDoc(input.docType, extracted.data);
  if (!verdict.pass) {
    if (verifiedPayment && paymentHeader) {
      await recordX402PaymentAttempt(
        env,
        paymentHeader,
        { route: new URL(request.url).pathname, failure_reason: "validator_failed" },
        verifiedPayment,
        null
      );
    }
    // GUARDRAILS LAW: schema/arithmetic failure → no settle, no mark, no token burn.
    return accessJson(
      {
        tool: TAP_SLUG,
        error: "validator_failed",
        doc_type: input.docType,
        settled: false,
        charged: false,
        failures: verdict.failures,
        discrepancy: verdict.discrepancy,
        evidence: verdict.evidence,
        note: "The extraction did not reconcile, so it was not charged and no work-mark was issued. Fix the source document (or its totals) and retry.",
      },
      422,
      CORS
    );
  }

  // Passed every gate → settle via handlePaidFetch with the precomputed, attested payload.
  const body = {
    tool: TAP_SLUG,
    doc_type: input.docType,
    source_url: input.url,
    validated: true,
    data: extracted.data,
    evidence: verdict.evidence,
    attestation: {
      basis: "evidence-only",
      claims: verdict.attestation_claims,
      disclaimer:
        "Evidence-only extraction. We measured structure and arithmetic — schema-valid, totals reconcile, dates parse, currency is ISO-4217. This is NOT legal verification, NOT a financial audit, and NOT advice. We did not read the source for legal or financial meaning.",
    },
    model_usage: extracted.usage,
  };

  if (verifiedPayment) {
    const settled = await settleBuiltPayment(verifiedPayment.built, verifiedPayment.accept, env);
    await recordX402PaymentAttempt(
      env,
      paymentHeader,
      { route: new URL(request.url).pathname },
      verifiedPayment,
      settled
    );
    if (!settled.ok) {
      return paymentVerifyFailureResponse(
        context,
        PRODUCT,
        verifiedPayment.requirement,
        settled,
        origin
      );
    }
    return completePaidNanoDelivery(context, PRODUCT, body, settled);
  }

  return handlePaidFetch(context, PRODUCT, async () => body, (t) => accessCheck(t, env));
}

/** Fetch the doc (SSRF-guarded by caller), forward as a `file` part, ask for structured JSON. */
async function extractDocument(env, input) {
  let res;
  try {
    res = await fetchWithTimeout(
      input.url,
      { method: "GET", headers: { Accept: "application/pdf,application/octet-stream,*/*" } },
      DOC_FETCH_TIMEOUT_MS
    );
  } catch {
    return { ok: false, status: 502, body: { error: "fetch_failed", note: "Could not retrieve the document URL." } };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: 502,
      body: { error: "fetch_failed", note: `Document host returned HTTP ${res.status}.`, http_status: res.status },
    };
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) {
    return { ok: false, status: 422, body: { error: "empty_document", note: "The URL returned an empty body." } };
  }
  if (buf.byteLength > MAX_DOC_BYTES) {
    return {
      ok: false,
      status: 413,
      body: { error: "document_too_large", note: `Document exceeds ${MAX_DOC_BYTES} bytes.`, bytes: buf.byteLength },
    };
  }

  const mime = pickMime(res.headers.get("content-type"), input.url);
  const filename = filenameFromUrl(input.url, mime);
  const dataUrl = `data:${mime};base64,${bytesToBase64(new Uint8Array(buf))}`;

  const messages = [
    { role: "system", content: systemPrompt(input.docType) },
    {
      role: "user",
      content: [
        { type: "text", text: userInstruction(input.docType) },
        { type: "file", file: { filename, file_data: dataUrl } },
      ],
    },
  ];

  const out = await callGemini(env, {
    messages,
    responseSchema: DOC_SCHEMAS[input.docType],
    maxTokens: 4096,
  });

  if (!out.ok) {
    if (out.degraded) {
      return {
        ok: false,
        status: 503,
        body: { error: "extraction_degraded", note: "Extraction model is temporarily unavailable. Retry with backoff.", retry_after_seconds: out.retryAfter || 30 },
      };
    }
    return {
      ok: false,
      status: 502,
      body: { error: "extraction_failed", detail: out.error || "model_error" },
    };
  }
  if (!out.json) {
    return { ok: false, status: 502, body: { error: "structured_parse_failed", note: "Model did not return valid structured JSON." } };
  }

  return { ok: true, data: out.json, usage: out.usage || null };
}

function systemPrompt(docType) {
  const base =
    "You are a precise document extraction engine. Read the attached file and return ONLY structured JSON matching the provided schema. Do not invent values. Use numbers (not strings) for monetary and quantity fields. Use ISO-8601 (YYYY-MM-DD) for every date and ISO-4217 alphabetic codes for currency. If a value is genuinely absent, use 0 for numbers and \"\" for strings.";
  if (docType === "invoice") {
    return (
      base +
      " For invoices: line_items[].amount MUST equal qty * unit_price; subtotal MUST equal the sum of line amounts; total MUST equal subtotal + tax. Transcribe the figures exactly as printed — do not 'correct' them."
    );
  }
  return base;
}

function userInstruction(docType) {
  return `Extract this ${docType} document into the structured JSON schema. Be faithful to the source.`;
}

function pickMime(contentType, url) {
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  if (ct && ct !== "application/octet-stream") return ct;
  const lower = url.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  return "application/pdf";
}

function filenameFromUrl(url, mime) {
  try {
    const p = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (p && /\.[a-z0-9]{2,5}$/i.test(p)) return p;
  } catch {
    /* fall through */
  }
  const ext = mime === "application/pdf" ? "pdf" : "bin";
  return `document.${ext}`;
}

/** ArrayBuffer → base64 in fixed chunks (avoids call-stack blowups on large docs). */
function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
