/**
 * Content Analysis refinery offering.
 *
 * Built for text-only agents that cannot natively consume video, audio, or PDF
 * sources. The refinery may create an internal transcript/markdown representation
 * for grounding, but the paid resource is transformative analysis, not verbatim
 * source reproduction.
 */

import {
  corsOptions,
  readOptionalJsonBody,
  handlePaidFetch,
  hasBarTabAccess,
  hasToolAccess,
  consumeMicroAccess,
  bearerToken,
  completePaidNanoDelivery,
  paymentVerifyFailureResponse,
} from "../../../_lib/bar-pay.js";
import { accessJson, verifyAccessToken } from "../../../_lib/access.js";
import { isAllowedMediaUrl, isVideoReferenceUrl } from "../../../_lib/url-guard.js";
import { runTranscribePipeline } from "../../../_lib/llm-workersai.js";
import { validateTranscription, TRANSCRIPT_OUTPUT_SCHEMA } from "../../../_lib/transcribe-validate.js";
import { recordX402PaymentAttempt, readRequestId } from "../../../_lib/x402-payment-log.js";
import {
  buildProductPaymentRequirements,
  readPaymentHeader,
  settleBuiltPayment,
  verifyPaymentHeader,
} from "../../../_lib/x402.js";

const TOOL_SLUG = "multimodal-content-analysis";
const TAP_SLUG = "analyze-video-audio-and-pdfs";
const PRICE_USD = 0.05;
const CAP_AUDIO_BYTES = 20 * 1024 * 1024;
const CAP_PDF_BYTES = 15 * 1024 * 1024;
const CAP_VIDEO_BYTES = 8 * 1024 * 1024;
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
    "Analyze video, audio, and PDFs for text-only agents. Give a public source URL and receive a compact, transformative understanding layer: executive summary, ranked key points, grounded questions and answers, language and modality. Internal transcription is used only as grounding and is not returned verbatim.",
  bazaarOutputSchema: {
    input: {
      type: "http",
      method: "GET",
      description: "Pass a public https source URL. Optional kind=audio|video|pdf and duration_seconds.",
      example: { url: "https://example.com/research-talk.mp4", kind: "video", duration_seconds: 2400 },
    },
    output: {
      tool: TAP_SLUG,
      media_kind: "video",
      language: "en",
      executive_summary: "A compact synthesis of the source in new words.",
      key_points: ["Primary claim", "Supporting result", "Important limitation"],
      qa: [{ question: "What matters most?", answer: "The source's most consequential point, grounded in the internal source representation." }],
      attestation: {
        basis: "evidence-only",
        claims: ["schema-valid structured analysis", "analysis grounded in internal source representation"],
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
    kind: u.searchParams.get("kind") || null,
    durationSeconds: numberOrNull(u.searchParams.get("duration_seconds")),
  });
}

export async function onRequestPost(context) {
  const parsed = await readOptionalJsonBody(context.request);
  if (!parsed.ok) {
    return accessJson({ error: "invalid_json", note: "POST { url, kind?, duration_seconds? }." }, 400, CORS);
  }
  return handle(context, {
    url: parsed.data?.url || null,
    kind: parsed.data?.kind || null,
    durationSeconds: numberOrNull(parsed.data?.duration_seconds),
  });
}

function accessCheck(token, env) {
  return (async () => {
    const tab = await hasBarTabAccess(token, env);
    if (tab) return { ok: true, claims: tab };
    const toolClaims = await hasToolAccess(token, TOOL_SLUG, env);
    if (toolClaims) return { ok: true, claims: toolClaims };
    return consumeMicroAccess(token, TAP_SLUG, TOOL_SLUG, env);
  })();
}

async function peekAccess(token, env) {
  const claims = await verifyAccessToken(token, env);
  if (!claims) return false;
  if (claims.scope === "bar_tab") return true;
  if (claims.scope === "tool" && claims.tool === TOOL_SLUG) return true;
  return (claims.scope === "nano" || claims.scope === "micro") && claims.tap === TAP_SLUG;
}

async function handle(context, input) {
  const { request, env } = context;
  const paymentHeader = readPaymentHeader(request);
  const token = bearerToken(request);
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;

  const credible = paymentHeader || (token && (await peekAccess(token, env)));
  if (!credible) return handlePaidFetch(context, PRODUCT, async () => ({}), (t) => accessCheck(t, env));

  let verifiedPayment = null;
  if (paymentHeader) {
    const requirements = buildProductPaymentRequirements(PRODUCT, request.url, env);
    if (!requirements) return accessJson({ error: "x402_not_configured", product: PRODUCT.id, priceUsd: PRODUCT.priceUsd }, 503, CORS);
    verifiedPayment = await verifyPaymentHeader(paymentHeader, requirements, env);
    if (!verifiedPayment.ok) {
      await recordX402PaymentAttempt(env, paymentHeader, { route: url.pathname, requestId: readRequestId(request) }, verifiedPayment, null);
      return paymentVerifyFailureResponse(context, PRODUCT, requirements, verifiedPayment, origin);
    }
  }

  if (!input.url) {
    return accessJson({ tool: TAP_SLUG, error: "no_input", note: "Provide a public video, audio, or PDF URL." }, 400, CORS);
  }

  const kind = resolveKind(input.kind, input.url);
  const isVideoRef = kind === "video" && isVideoReferenceUrl(input.url);
  if (!isVideoRef && !isAllowedMediaUrl(input.url)) {
    return accessJson({ tool: TAP_SLUG, error: "unsupported_or_unsafe_url", note: "Use a public allowlisted https media/document URL; YouTube/Vimeo references are accepted for video." }, 400, CORS);
  }

  const analyzed = await runTranscribePipeline(env, {
    kind,
    url: input.url,
    isVideoRef,
    caps: { audio: CAP_AUDIO_BYTES, pdf: CAP_PDF_BYTES, video: CAP_VIDEO_BYTES },
    storageRoute: "content-analysis",
    schemaPromptSpec: {
      system:
        "You are a multimodal content-analysis refinery for text-only agents. Build a faithful internal source representation, then analyze it. The transcript field is INTERNAL GROUNDING ONLY. Do not optimize for quotation. Detect language, summarize in new words, rank the most useful key points, and generate grounded Q&A. Never invent information absent from the source representation.",
      instruction: `Analyze this ${kind} source. Return the required JSON. Keep transcript as the internal source representation used to ground the analysis; it will not be delivered to the buyer.`,
      schema: TRANSCRIPT_OUTPUT_SCHEMA,
    },
  });
  if (!analyzed.ok) return accessJson({ tool: TAP_SLUG, ...analyzed.body }, analyzed.status, CORS);

  const validation = validateTranscription(analyzed.data.structured, { durationSeconds: input.durationSeconds });
  if (!validation.pass) {
    if (verifiedPayment && paymentHeader) {
      await recordX402PaymentAttempt(env, paymentHeader, { route: url.pathname, failure_reason: "validator_failed", requestId: readRequestId(request) }, verifiedPayment, null);
    }
    return accessJson({ tool: TAP_SLUG, error: "validator_failed", settled: false, charged: false, failures: validation.failures, evidence: validation.evidence }, 422, CORS);
  }

  const structured = analyzed.data.structured;
  const body = {
    tool: TAP_SLUG,
    media_kind: kind,
    source_url: input.url,
    language: structured.language,
    executive_summary: structured.summary,
    key_points: structured.key_points,
    qa: structured.qa,
    attestation: {
      basis: "evidence-only",
      claims: validation.attestation_claims.filter((c) => !/transcript/i.test(c)),
      note: "The refinery validated structure and grounding against its internal source representation. No claim of source factual correctness is made.",
    },
    model_usage: analyzed.data.usage,
  };

  if (verifiedPayment) {
    const settled = await settleBuiltPayment(verifiedPayment.built, verifiedPayment.accept, env);
    await recordX402PaymentAttempt(env, paymentHeader, { route: url.pathname, requestId: readRequestId(request) }, verifiedPayment, settled);
    if (!settled.ok) return paymentVerifyFailureResponse(context, PRODUCT, verifiedPayment.requirement, settled, origin);
    return completePaidNanoDelivery(context, PRODUCT, body, settled);
  }
  return handlePaidFetch(context, PRODUCT, async () => body, (t) => accessCheck(t, env));
}

function resolveKind(hint, url) {
  const h = String(hint || "").toLowerCase();
  if (["audio", "voice", "podcast"].includes(h)) return "audio";
  if (["pdf", "document", "doc"].includes(h)) return "pdf";
  if (h === "video") return "video";
  const lower = String(url).toLowerCase();
  if (isVideoReferenceUrl(url)) return "video";
  if (/\.pdf(?:\?|#|$)/.test(lower)) return "pdf";
  if (/\.(?:mp4|mov|webm|mkv|m4v)(?:\?|#|$)/.test(lower)) return "video";
  return "audio";
}

function numberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
