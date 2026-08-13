/**
 * Paper-to-Code refinery offering.
 *
 * Agents bring a research paper. Second Eyes converts the paper into an
 * implementation-ready repository package: staged plan, implementation analysis,
 * code files, tests, assumptions, dependencies, and source-grounding notes.
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
import { isSafeHttpUrl } from "../../../_lib/url-guard.js";
import { runPaperToCodePipeline } from "../../../_lib/llm-workersai.js";
import { validatePaperCodePackage } from "../../../_lib/paper-code-validate.js";
import { recordX402PaymentAttempt, readRequestId } from "../../../_lib/x402-payment-log.js";
import {
  buildProductPaymentRequirements,
  readPaymentHeader,
  settleBuiltPayment,
  verifyPaymentHeader,
} from "../../../_lib/x402.js";

const TOOL_SLUG = "paper-to-code";
const TAP_SLUG = "turn-paper-into-code";
const PRICE_USD = 0.25;
const MAX_PAPER_BYTES = 20 * 1024 * 1024;
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
    "Turn a research paper into working code. Give a public research-paper URL and receive an implementation-ready repository package with architecture, algorithms, dependencies, assumptions, source files, tests, and source-grounding notes. Generated in planning, implementation-analysis, and repository stages; payment settles only after deterministic package validation.",
  bazaarOutputSchema: {
    input: {
      type: "http",
      method: "POST",
      description: "Pass paper_url and optional target_language, framework, and repository_name.",
      example: {
        paper_url: "https://arxiv.org/pdf/1706.03762",
        target_language: "python",
        framework: "pytorch",
        repository_name: "attention-is-all-you-need",
      },
    },
    output: {
      tool: TAP_SLUG,
      repository: { name: "attention-is-all-you-need", language: "python", framework: "pytorch" },
      implementation_plan: ["Implement attention primitives", "Assemble encoder/decoder", "Add tests"],
      assumptions: ["Paper omits some training infrastructure details; implementation choices are identified explicitly."],
      dependencies: ["torch"],
      files: [
        { path: "src/model.py", purpose: "Core implementation", content: "..." },
        { path: "tests/test_model.py", purpose: "Behavioral tests", content: "..." },
      ],
      source_grounding: [{ implementation: "multi-head attention", paper_basis: "Method section and equations", confidence: "high" }],
    },
  },
};

export async function onRequestOptions() {
  return corsOptions("GET, POST, OPTIONS");
}

export async function onRequestGet(context) {
  const u = new URL(context.request.url);
  return handle(context, {
    paperUrl: u.searchParams.get("paper_url") || null,
    targetLanguage: cleanOptional(u.searchParams.get("target_language")),
    framework: cleanOptional(u.searchParams.get("framework")),
    repositoryName: cleanOptional(u.searchParams.get("repository_name")),
  });
}

export async function onRequestPost(context) {
  const parsed = await readOptionalJsonBody(context.request);
  if (!parsed.ok) {
    return accessJson({ error: "invalid_json", note: "POST { paper_url, target_language?, framework?, repository_name? }." }, 400, CORS);
  }
  return handle(context, {
    paperUrl: parsed.data?.paper_url || null,
    targetLanguage: cleanOptional(parsed.data?.target_language),
    framework: cleanOptional(parsed.data?.framework),
    repositoryName: cleanOptional(parsed.data?.repository_name),
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
  const requestUrl = new URL(request.url);
  const origin = `${requestUrl.protocol}//${requestUrl.host}`;

  const credible = paymentHeader || (token && (await peekAccess(token, env)));
  if (!credible) return handlePaidFetch(context, PRODUCT, async () => ({}), (t) => accessCheck(t, env));

  let verifiedPayment = null;
  if (paymentHeader) {
    const requirements = buildProductPaymentRequirements(PRODUCT, request.url, env);
    if (!requirements) return accessJson({ error: "x402_not_configured", product: PRODUCT.id, priceUsd: PRODUCT.priceUsd }, 503, CORS);
    verifiedPayment = await verifyPaymentHeader(paymentHeader, requirements, env);
    if (!verifiedPayment.ok) {
      await recordX402PaymentAttempt(env, paymentHeader, { route: requestUrl.pathname, requestId: readRequestId(request) }, verifiedPayment, null);
      return paymentVerifyFailureResponse(context, PRODUCT, requirements, verifiedPayment, origin);
    }
  }

  if (!input.paperUrl) {
    return accessJson({ tool: TAP_SLUG, error: "no_input", note: "Provide paper_url pointing to a public research-paper PDF or document." }, 400, CORS);
  }
  if (!isSafeHttpUrl(input.paperUrl)) {
    return accessJson({ tool: TAP_SLUG, error: "unsafe_url", note: "paper_url must be an absolute public https URL." }, 400, CORS);
  }

  const generated = await runPaperToCodePipeline(env, {
    paperUrl: input.paperUrl,
    targetLanguage: input.targetLanguage || "python",
    framework: input.framework || "",
    repositoryName: input.repositoryName || "paper-implementation",
    maxBytes: MAX_PAPER_BYTES,
  });
  if (!generated.ok) return accessJson({ tool: TAP_SLUG, ...generated.body }, generated.status, CORS);

  const verdict = validatePaperCodePackage(generated.data);
  if (!verdict.pass) {
    if (verifiedPayment && paymentHeader) {
      await recordX402PaymentAttempt(env, paymentHeader, { route: requestUrl.pathname, failure_reason: "validator_failed", requestId: readRequestId(request) }, verifiedPayment, null);
    }
    return accessJson({ tool: TAP_SLUG, error: "validator_failed", settled: false, charged: false, failures: verdict.failures, evidence: verdict.evidence }, 422, CORS);
  }

  const body = {
    tool: TAP_SLUG,
    paper_url: input.paperUrl,
    ...generated.data,
    attestation: {
      basis: "implementation-package-validation",
      claims: verdict.attestation_claims,
      evidence: verdict.evidence,
      note: "Generated code is a reconstructed implementation of the paper, not author-released reference code unless the source explicitly contained it. Assumptions and grounding notes identify inferred choices.",
    },
    model_usage: generated.usage || null,
  };

  if (verifiedPayment) {
    const settled = await settleBuiltPayment(verifiedPayment.built, verifiedPayment.accept, env);
    await recordX402PaymentAttempt(env, paymentHeader, { route: requestUrl.pathname, requestId: readRequestId(request) }, verifiedPayment, settled);
    if (!settled.ok) return paymentVerifyFailureResponse(context, PRODUCT, verifiedPayment.requirement, settled, origin);
    return completePaidNanoDelivery(context, PRODUCT, body, settled);
  }
  return handlePaidFetch(context, PRODUCT, async () => body, (t) => accessCheck(t, env));
}

function cleanOptional(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, 120) : null;
}
