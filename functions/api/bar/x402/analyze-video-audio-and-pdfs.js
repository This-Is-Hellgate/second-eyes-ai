/**
 * Content Analysis for text-only agents.
 *
 * Raw material: public video, audio, podcast, PDF, or document URL.
 * Refined product: structured understanding a text-to-text agent can reason over.
 *
 * The model may create private grounding text to validate its analysis, but the
 * paid response never returns a transcript or extracted source dump.
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
import { recordX402PaymentAttempt, readRequestId } from "../../../_lib/x402-payment-log.js";
import {
  buildProductPaymentRequirements,
  readPaymentHeader,
  settleBuiltPayment,
  verifyPaymentHeader,
} from "../../../_lib/x402.js";

const PRODUCT_SLUG = "analyze-video-audio-and-pdfs";
const PRICE_USD = 0.05;
const CORS = { "Access-Control-Allow-Origin": "*" };
const CAP_AUDIO_BYTES = 20 * 1024 * 1024;
const CAP_PDF_BYTES = 15 * 1024 * 1024;
const CAP_VIDEO_BYTES = 8 * 1024 * 1024;

const PRODUCT = {
  kind: "nano",
  id: PRODUCT_SLUG,
  slug: PRODUCT_SLUG,
  tool: PRODUCT_SLUG,
  tier: "nano",
  priceUsd: PRICE_USD,
  access: "paid",
  oneTime: true,
  description:
    "Analyze video, audio, podcasts, PDFs, and document URLs for text-only agents. Returns abstractive summary, semantic extraction, themes, entities, relationships, grounded Q&A, and an agent briefing. No verbatim transcript or source dump is returned.",
  bazaarOutputSchema: {
    input: {
      type: "http",
      method: "GET",
      description:
        "Pass a public HTTPS URL. Optional kind=audio|video|pdf and duration_seconds for audio/video.",
      example: {
        url: "https://youtu.be/VIDEO_ID",
        kind: "video",
      },
    },
    output: {
      tool: PRODUCT_SLUG,
      media_kind: "video",
      language: "en",
      abstractive_summary: "A concise source-grounded explanation in new wording.",
      semantic_extraction: {
        core_arguments: ["Primary argument"],
        data_points: ["Important quantitative or factual point"],
        conclusions: ["Main conclusion"],
      },
      thematic_distillation: [
        { theme: "theme", pain_points: ["problem"], solutions: ["solution"] },
      ],
      epistemic_map: {
        entities: [{ name: "Entity", type: "organization", role: "subject" }],
        relationships: [{ from: "Entity A", relationship: "depends_on", to: "Entity B" }],
        claims: [{ claim: "Claim", support: "Source-grounded support" }],
      },
      grounded_qa: [{ question: "Question", answer: "Grounded answer" }],
      agent_brief: {
        what_matters: "The minimum useful context for the next agent step.",
        what_to_verify: ["Claim worth independently checking"],
        next_actions: ["Useful downstream action"],
      },
    },
  },
};

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    language: { type: "string" },
    media_kind: { type: "string", enum: ["audio", "video", "pdf"] },
    grounding_text: {
      type: "string",
      description:
        "Private source-derived grounding text used only for validation. It is never returned to the buyer.",
    },
    abstractive_summary: { type: "string" },
    semantic_extraction: {
      type: "object",
      additionalProperties: false,
      properties: {
        core_arguments: { type: "array", items: { type: "string" } },
        data_points: { type: "array", items: { type: "string" } },
        conclusions: { type: "array", items: { type: "string" } },
      },
      required: ["core_arguments", "data_points", "conclusions"],
    },
    thematic_distillation: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          theme: { type: "string" },
          pain_points: { type: "array", items: { type: "string" } },
          solutions: { type: "array", items: { type: "string" } },
        },
        required: ["theme", "pain_points", "solutions"],
      },
    },
    epistemic_map: {
      type: "object",
      additionalProperties: false,
      properties: {
        entities: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              type: { type: "string" },
              role: { type: "string" },
            },
            required: ["name", "type", "role"],
          },
        },
        relationships: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              from: { type: "string" },
              relationship: { type: "string" },
              to: { type: "string" },
            },
            required: ["from", "relationship", "to"],
          },
        },
        claims: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              claim: { type: "string" },
              support: { type: "string" },
            },
            required: ["claim", "support"],
          },
        },
      },
      required: ["entities", "relationships", "claims"],
    },
    grounded_qa: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
        required: ["question", "answer"],
      },
    },
    agent_brief: {
      type: "object",
      additionalProperties: false,
      properties: {
        what_matters: { type: "string" },
        what_to_verify: { type: "array", items: { type: "string" } },
        next_actions: { type: "array", items: { type: "string" } },
      },
      required: ["what_matters", "what_to_verify", "next_actions"],
    },
  },
  required: [
    "language",
    "media_kind",
    "grounding_text",
    "abstractive_summary",
    "semantic_extraction",
    "thematic_distillation",
    "epistemic_map",
    "grounded_qa",
    "agent_brief",
  ],
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
    return accessJson(
      { error: "invalid_json", note: "POST { url, kind?, duration_seconds? }." },
      400,
      CORS
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
    const toolClaims = await hasToolAccess(token, PRODUCT_SLUG, env);
    if (toolClaims) return { ok: true, claims: toolClaims };
    return consumeMicroAccess(token, PRODUCT_SLUG, PRODUCT_SLUG, env);
  })();
}

async function peekAccess(token, env) {
  const claims = await verifyAccessToken(token, env);
  if (!claims) return false;
  if (claims.scope === "bar_tab") return true;
  if (claims.scope === "tool" && claims.tool === PRODUCT_SLUG) return true;
  if ((claims.scope === "nano" || claims.scope === "micro") && claims.tap === PRODUCT_SLUG) return true;
  return false;
}

async function handle(context, input) {
  const { request, env } = context;
  const paymentHeader = readPaymentHeader(request);
  const token = bearerToken(request);
  const requestUrl = new URL(request.url);
  const origin = `${requestUrl.protocol}//${requestUrl.host}`;

  const credible = paymentHeader || (token && (await peekAccess(token, env)));
  if (!credible) {
    return handlePaidFetch(context, PRODUCT, async () => ({}), (t) => accessCheck(t, env));
  }

  let verifiedPayment = null;
  if (paymentHeader) {
    const requirements = buildProductPaymentRequirements(PRODUCT, request.url, env);
    if (!requirements) {
      return accessJson({ error: "x402_not_configured", product: PRODUCT_SLUG }, 503, CORS);
    }
    verifiedPayment = await verifyPaymentHeader(paymentHeader, requirements, env);
    if (!verifiedPayment.ok) {
      await recordX402PaymentAttempt(
        env,
        paymentHeader,
        { route: requestUrl.pathname, requestId: readRequestId(request) },
        verifiedPayment,
        null
      );
      return paymentVerifyFailureResponse(context, PRODUCT, requirements, verifiedPayment, origin);
    }
  }

  if (!input.url) {
    return accessJson(
      {
        tool: PRODUCT_SLUG,
        error: "no_input",
        note: "Provide a public video, audio, podcast, PDF, or document URL.",
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
        tool: PRODUCT_SLUG,
        error: "unsupported_or_unsafe_url",
        note: "URL must be HTTPS on an allowlisted media/document host. YouTube/Vimeo references are supported for video.",
      },
      400,
      CORS
    );
  }

  const analyzed = await runContentAnalysis(env, input, kind, isVideoRef);
  if (!analyzed.ok) {
    return accessJson({ tool: PRODUCT_SLUG, ...analyzed.body }, analyzed.status, CORS);
  }

  const verdict = validateAnalysis(analyzed.data.structured);
  if (!verdict.pass) {
    return accessJson(
      {
        tool: PRODUCT_SLUG,
        error: "validator_failed",
        settled: false,
        charged: false,
        failures: verdict.failures,
      },
      422,
      CORS
    );
  }

  const s = analyzed.data.structured;
  const body = {
    tool: PRODUCT_SLUG,
    media_kind: kind,
    source_url: input.url,
    language: s.language,
    abstractive_summary: s.abstractive_summary,
    semantic_extraction: s.semantic_extraction,
    thematic_distillation: s.thematic_distillation,
    epistemic_map: s.epistemic_map,
    grounded_qa: s.grounded_qa,
    agent_brief: s.agent_brief,
    attestation: {
      basis: "source-grounded-transformative-analysis",
      claims: [
        "private grounding material present",
        "structured analysis schema complete",
        "analysis vocabulary overlaps source-derived grounding material",
        "no verbatim transcript returned",
      ],
      disclaimer:
        "Transformative analysis, not a verbatim transcript and not a claim that every source statement is factually correct.",
    },
    model_usage: analyzed.data.usage || null,
  };

  if (verifiedPayment) {
    const settled = await settleBuiltPayment(verifiedPayment.built, verifiedPayment.accept, env);
    await recordX402PaymentAttempt(
      env,
      paymentHeader,
      { route: requestUrl.pathname, requestId: readRequestId(request) },
      verifiedPayment,
      settled
    );
    if (!settled.ok) {
      return paymentVerifyFailureResponse(context, PRODUCT, verifiedPayment.requirement, settled, origin);
    }
    return completePaidNanoDelivery(context, PRODUCT, body, settled);
  }

  return handlePaidFetch(context, PRODUCT, async () => body, (t) => accessCheck(t, env));
}

async function runContentAnalysis(env, input, kind, isVideoRef) {
  const system =
    "You are a multimodal content analyst for text-only AI agents. Convert inaccessible media into compact structured understanding. Do not return a transcript to the user. Create grounding_text privately from the source so the server can validate your analysis, then write all public analysis fields in your own wording. Identify arguments, data points, conclusions, themes, entities, relationships, claims, useful Q&A, and what another agent should do next. Do not invent details absent from the source. Return only the requested JSON schema.";

  const instruction =
    `Analyze this ${kind} source for a text-only agent. Set media_kind to ${kind}. ` +
    "grounding_text must faithfully capture enough source language for validation, while every other field must be transformative analysis rather than a source dump.";

  const result = await runTranscribePipeline(env, {
    kind,
    url: input.url,
    isVideoRef,
    caps: { audio: CAP_AUDIO_BYTES, pdf: CAP_PDF_BYTES, video: CAP_VIDEO_BYTES },
    schemaPromptSpec: { system, instruction, schema: ANALYSIS_SCHEMA },
  });

  if (!result.ok) return result;
  return { ok: true, data: result.data };
}

function validateAnalysis(s) {
  const failures = [];
  if (!s || typeof s !== "object") return { pass: false, failures: ["output_not_object"] };
  if (!String(s.language || "").trim()) failures.push("language_missing");
  if (!String(s.grounding_text || "").trim()) failures.push("grounding_text_missing");
  if (!String(s.abstractive_summary || "").trim()) failures.push("summary_missing");
  if (!Array.isArray(s.semantic_extraction?.core_arguments)) failures.push("core_arguments_missing");
  if (!Array.isArray(s.semantic_extraction?.data_points)) failures.push("data_points_missing");
  if (!Array.isArray(s.semantic_extraction?.conclusions)) failures.push("conclusions_missing");
  if (!Array.isArray(s.thematic_distillation)) failures.push("themes_missing");
  if (!Array.isArray(s.epistemic_map?.entities)) failures.push("entities_missing");
  if (!Array.isArray(s.epistemic_map?.relationships)) failures.push("relationships_missing");
  if (!Array.isArray(s.epistemic_map?.claims)) failures.push("claims_missing");
  if (!Array.isArray(s.grounded_qa)) failures.push("qa_missing");
  if (!String(s.agent_brief?.what_matters || "").trim()) failures.push("agent_brief_missing");

  const grounding = new Set(tokens(s.grounding_text));
  const publicText = JSON.stringify({
    abstractive_summary: s.abstractive_summary,
    semantic_extraction: s.semantic_extraction,
    thematic_distillation: s.thematic_distillation,
    epistemic_map: s.epistemic_map,
    grounded_qa: s.grounded_qa,
    agent_brief: s.agent_brief,
  });
  const words = tokens(publicText).filter((w) => w.length > 3);
  if (grounding.size && words.length) {
    const hits = words.filter((w) => grounding.has(w)).length;
    if (hits / words.length < 0.12) failures.push("analysis_not_grounded");
  }

  return { pass: failures.length === 0, failures };
}

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function resolveKind(hint, url) {
  const h = String(hint || "").toLowerCase();
  if (["audio", "voice", "podcast"].includes(h)) return "audio";
  if (["pdf", "document", "doc"].includes(h)) return "pdf";
  if (h === "video") return "video";
  const lower = String(url).toLowerCase();
  if (isVideoReferenceUrl(url)) return "video";
  if (/\.pdf(\?|#|$)/.test(lower)) return "pdf";
  if (/\.(mp4|mov|webm|mkv|m4v)(\?|#|$)/.test(lower)) return "video";
  return "audio";
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
