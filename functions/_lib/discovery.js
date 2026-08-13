import * as legacy from "./discovery-legacy.js";

export const discoveryJson = legacy.discoveryJson;
export const buildApiDocsPointer = legacy.buildApiDocsPointer;

const CONTENT_PATH = "/api/bar/x402/analyze-video-audio-and-pdfs";
const PAPER_PATH = "/api/bar/x402/turn-paper-into-code";

const CONTENT_SUMMARY =
  "Text-only agent cannot understand a video, audio recording, or PDF → receive compact grounded content analysis in text: executive summary, ranked key points, and grounded Q&A. No verbatim transcript is sold.";
const PAPER_SUMMARY =
  "Give a research paper → receive an implementation-ready code repository package with plan, assumptions, dependencies, source files, tests, and paper-grounding notes.";

export function buildOpenApi(origin, env) {
  const spec = legacy.buildOpenApi(origin, env);
  const oldContent = spec.paths["/api/bar/x402/transcribe"];
  const oldPaper = spec.paths["/api/bar/x402/extract"];

  if (oldContent) spec.paths[CONTENT_PATH] = rewriteOperationEntry(oldContent, "analyze-video-audio-and-pdfs", CONTENT_SUMMARY, 0.05, [
    { name: "url", type: "string", required: true, description: "Public https URL of the video, audio, or PDF source." },
    { name: "kind", type: "string", enum: ["audio", "video", "pdf"], description: "Optional source kind; inferred when omitted." },
    { name: "duration_seconds", type: "number", description: "Optional known duration for audio/video plausibility checks." },
  ]);

  if (oldPaper) spec.paths[PAPER_PATH] = rewriteOperationEntry(oldPaper, "turn-paper-into-code", PAPER_SUMMARY, 0.25, [
    { name: "paper_url", type: "string", required: true, description: "Public https URL of the research paper PDF/document." },
    { name: "target_language", type: "string", description: "Preferred implementation language; defaults to python." },
    { name: "framework", type: "string", description: "Optional preferred framework, e.g. pytorch or jax." },
    { name: "repository_name", type: "string", description: "Optional output repository name." },
  ]);

  delete spec.paths["/api/bar/x402/transcribe"];
  delete spec.paths["/api/bar/x402/extract"];

  if (spec["x-guidance"]?.decision_tree) {
    delete spec["x-guidance"].decision_tree.media_transcription;
    delete spec["x-guidance"].decision_tree.document_extraction;
    spec["x-guidance"].decision_tree.multimodal_content_analysis = `${origin.replace(/\/$/, "")}${CONTENT_PATH}`;
    spec["x-guidance"].decision_tree.research_paper_to_code = `${origin.replace(/\/$/, "")}${PAPER_PATH}`;
  }
  if (spec.info) {
    spec.info.summary = "Machine-readable map of paid agent services, including the two confirmed Second Eyes data-refinery offerings.";
  }
  return spec;
}

export function buildX402Resources(origin, env, opts) {
  const out = legacy.buildX402Resources(origin, env, opts);
  out.resources = out.resources.map((r) => {
    if (r.slug === "transcribe" || r.resource?.endsWith("/transcribe")) {
      return {
        ...r,
        resource: `${origin.replace(/\/$/, "")}${CONTENT_PATH}`,
        slug: "analyze-video-audio-and-pdfs",
        summary: CONTENT_SUMMARY,
        price_usd: 0.05,
        input: {
          method: ["GET", "POST"],
          fields: {
            url: "string (required) — public video/audio/PDF URL",
            kind: "string (optional) — audio|video|pdf",
            duration_seconds: "number (optional)",
          },
        },
      };
    }
    if (r.slug === "extract" || r.resource?.endsWith("/extract")) {
      return {
        ...r,
        resource: `${origin.replace(/\/$/, "")}${PAPER_PATH}`,
        slug: "turn-paper-into-code",
        summary: PAPER_SUMMARY,
        price_usd: 0.25,
        input: {
          method: ["GET", "POST"],
          fields: {
            paper_url: "string (required) — public research paper URL",
            target_language: "string (optional)",
            framework: "string (optional)",
            repository_name: "string (optional)",
          },
        },
      };
    }
    return r;
  });
  return out;
}

function rewriteOperationEntry(entry, slug, summary, price, fields) {
  const copy = JSON.parse(JSON.stringify(entry));
  for (const method of ["get", "post"]) {
    const op = copy[method];
    if (!op) continue;
    op.operationId = `${slug}_${method}`;
    op.summary = summary;
    op.description = `${summary} Session-less x402 door — pay USDC on Base and retry with PAYMENT-SIGNATURE.`;
    op["x-price-usd"] = price;
    if (op["x-payment-info"]) {
      op["x-payment-info"].price_usd = price;
      op["x-payment-info"].price = { mode: "fixed", currency: "USD", amount: price.toFixed(2) };
    }
    if (op["x-guidance"]) {
      op["x-guidance"].call_when = summary;
      op["x-guidance"].price_usd = price;
    }
  }

  const headers = (copy.get?.parameters || []).filter((p) => p.in === "header");
  if (copy.get) {
    copy.get.parameters = [
      ...fields.map((f) => ({
        name: f.name,
        in: "query",
        required: false,
        schema: { type: f.type, ...(f.enum ? { enum: f.enum } : {}) },
        description: `${f.required ? "Required for a useful result. " : "Optional. "}${f.description}`,
      })),
      ...headers,
    ];
  }
  if (copy.post) {
    const properties = {};
    const required = [];
    for (const f of fields) {
      properties[f.name] = { type: f.type, ...(f.enum ? { enum: f.enum } : {}), description: f.description };
      if (f.required) required.push(f.name);
    }
    copy.post.requestBody = {
      required: false,
      content: {
        "application/json": {
          schema: { type: "object", properties, ...(required.length ? { required } : {}) },
        },
      },
    };
  }
  return copy;
}
