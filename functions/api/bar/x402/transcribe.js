/**
 * /api/bar/x402/transcribe ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â multimodal transcription & meaning extraction door.
 *
 * Give it any public media or document URL ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â a podcast episode, a voice memo, a
 * recorded call, a PDF, a YouTube video ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â and get back a transcript PLUS the
 * meaning: a summary, ranked key points, and grounded Q&A. Session-less, one
 * nano payment, settles to the single lounge wallet via the shared spine.
 *
 *   GET  /api/bar/x402/transcribe?url=https://ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦&kind=audio&duration_seconds=1830
 *   POST /api/bar/x402/transcribe  { "url": "https://ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦", "kind": "pdf" }
 *
 * Quality is gated deterministically BEFORE settlement (transcribe-validate):
 * schema-valid, plausible words/min, no decode loop, meaning grounded in the
 * transcript. Model runs only after a credible payment/access signal; settlement
 * happens ONLY when every gate passes. On validator failure we return
 * validator_failed with settled:false ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â no charge, no attestation, no mark.
 *
 *   GET  /api/bar/x402/transcribe?url=https://ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦&kind=audio&duration_seconds=1830
 *   POST /api/bar/x402/transcribe  { "url": "https://ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦", "kind": "pdf" }
 *
 * The attestation is EVIDENCE-ONLY ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â it states what we measured, never that the
 * transcript is "accurate" (we did not hear the audio).
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
import { fetchWithTimeout } from "../../../_lib/resilience.js";
import { isAllowedMediaUrl, isVideoReferenceUrl } from "../../../_lib/url-guard.js";
import { runTranscribePipeline } from "../../../_lib/llm-workersai.js";
import {
  validateTranscription,
  TRANSCRIPT_OUTPUT_SCHEMA,
} from "../../../_lib/transcribe-validate.js";
import { CANONICAL_HOST } from "../../../_lib/brand.js";
import { recordX402PaymentAttempt, readRequestId } from "../../../_lib/x402-payment-log.js";
import {
  buildProductPaymentRequirements,
  readPaymentHeader,
  settleBuiltPayment,
  verifyPaymentHeader,
} from "../../../_lib/x402.js";

const TOOL_SLUG = "x402-survival";
const TAP_SLUG = "transcribe-extract";
const PRICE_USD = 0.05;

// Raw-byte caps before base64. Audio is the main case; video clips are kept tiny
// (prefer a YouTube/Vimeo reference URL); PDFs are bounded for model context.
const CAP_AUDIO_BYTES = 20 * 1024 * 1024;
const CAP_PDF_BYTES = 15 * 1024 * 1024;
const CAP_VIDEO_BYTES = 8 * 1024 * 1024;
const MEDIA_FETCH_TIMEOUT_MS = 30_000;
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
    "content-analysis (multimodal, session-less x402): give it any public audio, voice note, podcast, PDF, or direct video file URL and get back structured content analysis in the model's own words -- a summary, ranked key points, and grounded Q&A you can query. No verbatim transcript is returned. Deterministically validated (schema, meaning grounded in source) before it is served; evidence-only attestation, never a claim of accuracy. Launch recovery pricing.",
  bazaarOutputSchema: {
    input: {
      type: "http",
      method: "GET",
      description:
        "Pass an https media/document URL on an allowlisted host. Optional kind=audio|pdf|video (inferred when omitted) and duration_seconds for audio/video to enable a words/min plausibility check.",
      example: {
        url: "https://storage.googleapis.com/example-bucket/interview.mp3",
        kind: "audio",
        duration_seconds: 1830,
      },
    },
    output: {
      tool: TAP_SLUG,
      media_kind: "audio",
      language: "en",
      transcript: "Welcome back to the show. Today we are talking aboutÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦",
      summary: "A 30-minute interview on agent payment rails and why settlement reputation compounds.",
      key_points: [
        "x402 indexes individual routes, not sites",
        "Distinct-buyer signal compounds on one wallet",
        "Recency tax: surfaces drop after 30 days without settlement",
      ],
      qa: [
        {
          question: "Why keep one wallet?",
          answer: "On-chain reputation and buyer-reach are keyed to a single payTo; splitting fragments the signal.",
        },
      ],
      attestation: {
        schema: "second-eye/transcription-attestation/v1",
        validated: [
          "schema-valid structured output",
          "words/min in range (164)",
          "no repetition loop",
          "meaning grounded in transcript",
        ],
        disclaimer:
          "Evidence-only. Validates structure, plausibility, and grounding ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â NOT factual accuracy of the transcript.",
        signature: "hmac-sha256:ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦",
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
  // An empty/blank body is a valid bare probe and must reach the x402 paywall (402);
  // only a non-empty malformed body is 400. Missing url is surfaced as no_input
  // AFTER the credible-payment gate (see handle()), never as a pre-paywall 400.
  const parsed = await readOptionalJsonBody(context.request);
  if (!parsed.ok) {
    return accessJson(
      { error: "invalid_json", note: "POST a JSON body: { url, kind?, duration_seconds? }." },
      400,
      { "Access-Control-Allow-Origin": "*" }
    );
  }
  const data = parsed.data;
  return handle(context, {
    url: data?.url || null,
    kind: data?.kind || null,
    durationSeconds: numberOrNull(data?.duration_seconds),
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
  if ((claims.scope === "nano" || claims.scope === "micro") && claims.tap === TAP_SLUG) return true;
  return false;
}

async function handle(context, input) {
  const { request, env } = context;
  const paymentHeader = readPaymentHeader(request);
  const token = bearerToken(request);
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;

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
        { route: new URL(request.url).pathname, requestId: readRequestId(request) },
        verifiedPayment,
        null
      );
      return paymentVerifyFailureResponse(context, PRODUCT, requirements, verifiedPayment, origin);
    }
  }

  if (!input.url) {
    return accessJson(
      {
        tool: TAP_SLUG,
        error: "no_input",
        note: "Provide a media/document URL.",
        usage: {
          audio: "GET /api/bar/x402/transcribe?url=https://host/episode.mp3&kind=audio&duration_seconds=1830",
          pdf: "POST /api/bar/x402/transcribe { url: 'https://host/paper.pdf', kind: 'pdf' }",
          video: "GET /api/bar/x402/transcribe?url=https://youtu.be/VIDEO_ID&kind=video",
        },
      },
      400,
      CORS
    );
  }

  const kind = resolveKind(input.kind, input.url);
  const isVideoRef = kind === "video" && isVideoReferenceUrl(input.url);
  if (!isVideoRef && !isAllowedMediaUrl(input.url)) {
    return accessJson(
      {
        tool: TAP_SLUG,
        error: "unsupported_or_unsafe_url",
        note: "URL must be https on an allowlisted media/document host (SSRF + ToS guard). For video, pass a YouTube/Vimeo URL.",
        provided: input.url,
      },
      400,
      CORS
    );
  }

  const transcribed = await transcribeMedia(env, input, kind, isVideoRef);
  if (!transcribed.ok) {
    return accessJson({ tool: TAP_SLUG, ...transcribed.body }, transcribed.status, CORS);
  }

  const validation = validateTranscription(transcribed.data.structured, {
    durationSeconds: input.durationSeconds,
  });
  if (!validation.pass) {
    if (verifiedPayment && paymentHeader) {
      await recordX402PaymentAttempt(
        env,
        paymentHeader,
        { route: new URL(request.url).pathname, failure_reason: "validator_failed", requestId: readRequestId(request) },
        verifiedPayment,
        null
      );
    }
    return accessJson(
      {
        tool: TAP_SLUG,
        error: "validator_failed",
        reason: "deterministic_validation_failed",
        settled: false,
        charged: false,
        failures: validation.failures,
        evidence: validation.evidence,
        note: "Output did not pass the validation gate, so it was not charged and no work-mark was issued. Retry with different media or duration_seconds.",
      },
      422,
      CORS
    );
  }

  const structured = transcribed.data.structured;
  const attestation = await buildAttestation(env, validation, {
    resource: `${origin}/api/bar/x402/transcribe`,
    media_kind: kind,
    language: structured.language,
  });

  const body = {
    tool: TAP_SLUG,
    media_kind: kind,
    source_url: input.url,
    language: structured.language,
    summary: structured.summary,
    key_points: structured.key_points,
    qa: structured.qa,
    attestation,
    usage: transcribed.data.usage,
  };

  if (verifiedPayment) {
    const settled = await settleBuiltPayment(verifiedPayment.built, verifiedPayment.accept, env);
    await recordX402PaymentAttempt(
      env,
      paymentHeader,
      { route: new URL(request.url).pathname, requestId: readRequestId(request) },
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

async function transcribeMedia(env, input, kind, isVideoRef) {
  const instruction =
    kind === "pdf"
      ? "Extract the full text of this document verbatim into `transcript`, then produce its meaning."
      : kind === "video"
      ? "Transcribe the spoken content of this video verbatim into `transcript`, then produce its meaning."
      : "Transcribe this audio verbatim into `transcript`, then produce its meaning.";

  const system =
    "You are a precise transcription and meaning-extraction engine. Transcribe verbatim - do NOT summarize inside the transcript, do NOT invent content, do NOT loop or repeat phrases to fill space. Detect the language. Then derive a faithful summary, ranked key_points, and grounded qa drawn ONLY from the transcript. Return strictly the requested JSON schema.";

  const caps = { audio: CAP_AUDIO_BYTES, pdf: CAP_PDF_BYTES, video: CAP_VIDEO_BYTES };

  const result = await runTranscribePipeline(env, {
    kind,
    url: input.url,
    isVideoRef,
    caps,
    schemaPromptSpec: {
      system,
      instruction: `${instruction} Set media_kind to "${kind}". If the media is unintelligible or empty, return an empty transcript rather than fabricating.`,
      schema: TRANSCRIPT_OUTPUT_SCHEMA,
    },
  });

  if (!result.ok) return result;
  return { ok: true, data: result.data };
}function resolveKind(hint, url) {
  const h = String(hint || "").toLowerCase();
  if (h === "audio" || h === "voice" || h === "podcast") return "audio";
  if (h === "pdf" || h === "document" || h === "doc") return "pdf";
  if (h === "video") return "video";

  const lower = String(url).toLowerCase();
  if (isVideoReferenceUrl(url)) return "video";
  if (/\.pdf(\?|#|$)/.test(lower)) return "pdf";
  if (/\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|mp4a)(\?|#|$)/.test(lower)) return "audio";
  if (/\.(mp4|mov|webm|mkv|m4v)(\?|#|$)/.test(lower)) return "video";
  return "audio";
}

async function buildMediaPart(kind, url, isVideoRef) {
  if (kind === "video" && isVideoRef) {
    // Reference-only: hand the URL to the model, do not download.
    return { part: { type: "text", text: `VIDEO_URL: ${url}` }, reference: true };
  }

  const cap =
    kind === "pdf" ? CAP_PDF_BYTES : kind === "video" ? CAP_VIDEO_BYTES : CAP_AUDIO_BYTES;

  const res = await fetchWithTimeout(
    url,
    { method: "GET", headers: { Accept: "*/*" } },
    MEDIA_FETCH_TIMEOUT_MS
  );
  if (!res.ok) {
    return { error: "media_unreachable", status: res.status, provided: url };
  }

  const declared = Number(res.headers.get("content-length") || 0);
  if (declared && declared > cap) {
    return {
      error: "media_too_large",
      note: `Content-Length ${declared} exceeds cap ${cap} bytes for kind=${kind}. Use a shorter clip or a reference URL.`,
    };
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength > cap) {
    return {
      error: "media_too_large",
      note: `Fetched ${buf.byteLength} bytes exceeds cap ${cap} for kind=${kind}.`,
    };
  }

  const bytes = new Uint8Array(buf);
  const b64 = base64FromBytes(bytes);
  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim();

  if (kind === "pdf") {
    return {
      part: {
        type: "file",
        file: {
          filename: fileNameFromUrl(url, "document.pdf"),
          file_data: `data:application/pdf;base64,${b64}`,
        },
      },
    };
  }

  if (kind === "video") {
    // Short base64 clip only. Pass as a file part with its declared content type.
    return {
      part: {
        type: "file",
        file: {
          filename: fileNameFromUrl(url, "clip.mp4"),
          file_data: `data:${contentType || "video/mp4"};base64,${b64}`,
        },
      },
    };
  }

  // audio
  return {
    part: {
      type: "input_audio",
      input_audio: { data: b64, format: audioFormat(contentType, url) },
    },
  };
}

function buildMessages(kind, mediaPart) {
  const instruction =
    kind === "pdf"
      ? "Extract the full text of this document verbatim into `transcript`, then produce its meaning."
      : kind === "video"
      ? "Transcribe the spoken content of this video verbatim into `transcript`, then produce its meaning."
      : "Transcribe this audio verbatim into `transcript`, then produce its meaning.";

  return [
    {
      role: "system",
      content:
        "You are a precise transcription and meaning-extraction engine. Transcribe verbatim ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â do NOT summarize inside the transcript, do NOT invent content, do NOT loop or repeat phrases to fill space. Detect the language. Then derive a faithful summary, ranked key_points, and grounded qa drawn ONLY from the transcript. Return strictly the requested JSON schema.",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${instruction} Set media_kind to "${kind}". If the media is unintelligible or empty, return an empty transcript rather than fabricating.`,
        },
        mediaPart,
      ],
    },
  ];
}

/** HMAC-SHA256 signed, evidence-only attestation over the measured claims. */
async function buildAttestation(env, validation, meta) {
  const body = {
    schema: "second-eye/transcription-attestation/v1",
    issued_by: CANONICAL_HOST,
    resource: meta.resource,
    media_kind: meta.media_kind,
    language: meta.language || null,
    validated: validation.attestation_claims,
    evidence: validation.evidence,
    issued_at: new Date().toISOString(),
    disclaimer:
      "Evidence-only. Validates structure, plausibility (words/min), absence of decode loops, and that the meaning is grounded in the transcript. This is NOT a claim that the transcript is factually accurate or verified-correct.",
  };

  const signature = await hmacSign(env.ACCESS_TOKEN_SECRET, canonicalJson(body));
  return { ...body, signature: signature ? `hmac-sha256:${signature}` : null };
}

function numberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fileNameFromUrl(url, fallback) {
  try {
    const p = new URL(url).pathname.split("/").filter(Boolean).pop();
    return p || fallback;
  } catch {
    return fallback;
  }
}

function audioFormat(contentType, url) {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("wav")) return "wav";
  if (ct.includes("mpeg") || ct.includes("mp3")) return "mp3";
  if (ct.includes("ogg") || ct.includes("opus")) return "ogg";
  if (ct.includes("aac")) return "aac";
  if (ct.includes("flac")) return "flac";
  if (ct.includes("mp4") || ct.includes("m4a")) return "m4a";
  const lower = String(url).toLowerCase();
  const ext = (lower.match(/\.([a-z0-9]+)(?:\?|#|$)/) || [])[1];
  if (ext === "wav") return "wav";
  if (ext === "ogg" || ext === "oga" || ext === "opus") return "ogg";
  if (ext === "aac") return "aac";
  if (ext === "flac") return "flac";
  if (ext === "m4a" || ext === "mp4a") return "m4a";
  return "mp3";
}

/** Chunked base64 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â avoids call-stack blowups on large byte arrays. */
function base64FromBytes(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function canonicalJson(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

async function hmacSign(secret, data) {
  if (!secret) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
