/**
 * Turn Paper Into Code.
 *
 * Raw material: a public research-paper PDF.
 * Refined product: a source-grounded implementation package a coding agent can
 * pick up immediately — architecture, algorithms, dependencies, source files,
 * tests, commands, assumptions, and fidelity notes.
 *
 * Generated code is not described as execution-verified unless a future sandbox
 * genuinely executes it. This endpoint currently validates package structure and
 * source-grounding boundaries before settlement.
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
import { isSafeHttpUrl } from "../../../_lib/url-guard.js";
import { runExtractPipeline } from "../../../_lib/llm-workersai.js";
import { recordX402PaymentAttempt, readRequestId } from "../../../_lib/x402-payment-log.js";
import {
  buildProductPaymentRequirements,
  readPaymentHeader,
  settleBuiltPayment,
  verifyPaymentHeader,
} from "../../../_lib/x402.js";

const PRODUCT_SLUG = "turn-paper-into-code";
const PRICE_USD = 0.05;
const MAX_PAPER_BYTES = 20 * 1024 * 1024;
const PAPER_FETCH_TIMEOUT_MS = 20_000;
const CORS = { "Access-Control-Allow-Origin": "*" };

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
    "Give us a research-paper PDF and get back a source-grounded implementation package: architecture, algorithms, dependencies, code files, tests, install/run commands, assumptions, and a fidelity report that separates paper-supported details from inferred engineering choices.",
  bazaarOutputSchema: {
    input: {
      type: "http",
      method: "GET",
      description:
        "Pass a public HTTPS research-paper PDF URL. Optional language and target describe the preferred implementation environment.",
      example: {
        url: "https://arxiv.org/pdf/1706.03762",
        language: "python",
        target: "reference implementation",
      },
    },
    output: {
      tool: PRODUCT_SLUG,
      paper: {
        title: "Paper title",
        objective: "What the paper is trying to accomplish",
        contributions: ["Contribution"],
      },
      implementation: {
        language: "python",
        architecture: [{ component: "model", responsibility: "core paper method" }],
        algorithms: [
          { name: "algorithm", source_basis: "Section 3", steps: ["step one", "step two"] },
        ],
        dependencies: ["numpy"],
        files: [{ path: "src/model.py", purpose: "core implementation", code: "..." }],
        tests: [{ path: "tests/test_model.py", purpose: "smoke test", code: "..." }],
        install_commands: ["pip install -r requirements.txt"],
        run_commands: ["pytest -q"],
      },
      assumptions: [
        { assumption: "Engineering choice", reason: "Paper leaves this unspecified" },
      ],
      fidelity: {
        paper_supported: ["Method directly specified by the paper"],
        inferred_choices: ["Implementation choice made by the refinery"],
        unresolved: ["Detail requiring author code or further research"],
      },
      execution_verified: false,
    },
  },
};

const PAPER_TO_CODE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    paper: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        objective: { type: "string" },
        contributions: { type: "array", items: { type: "string" } },
      },
      required: ["title", "objective", "contributions"],
    },
    implementation: {
      type: "object",
      additionalProperties: false,
      properties: {
        language: { type: "string" },
        architecture: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              component: { type: "string" },
              responsibility: { type: "string" },
            },
            required: ["component", "responsibility"],
          },
        },
        algorithms: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              source_basis: { type: "string" },
              steps: { type: "array", items: { type: "string" } },
            },
            required: ["name", "source_basis", "steps"],
          },
        },
        dependencies: { type: "array", items: { type: "string" } },
        files: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: { type: "string" },
              purpose: { type: "string" },
              code: { type: "string" },
            },
            required: ["path", "purpose", "code"],
          },
        },
        tests: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              path: { type: "string" },
              purpose: { type: "string" },
              code: { type: "string" },
            },
            required: ["path", "purpose", "code"],
          },
        },
        install_commands: { type: "array", items: { type: "string" } },
        run_commands: { type: "array", items: { type: "string" } },
      },
      required: [
        "language",
        "architecture",
        "algorithms",
        "dependencies",
        "files",
        "tests",
        "install_commands",
        "run_commands",
      ],
    },
    assumptions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          assumption: { type: "string" },
          reason: { type: "string" },
        },
        required: ["assumption", "reason"],
      },
    },
    fidelity: {
      type: "object",
      additionalProperties: false,
      properties: {
        paper_supported: { type: "array", items: { type: "string" } },
        inferred_choices: { type: "array", items: { type: "string" } },
        unresolved: { type: "array", items: { type: "string" } },
      },
      required: ["paper_supported", "inferred_choices", "unresolved"],
    },
    execution_verified: { type: "boolean", enum: [false] },
  },
  required: ["paper", "implementation", "assumptions", "fidelity", "execution_verified"],
};

export async function onRequestOptions() {
  return corsOptions("GET, POST, OPTIONS");
}

export async function onRequestGet(context) {
  const u = new URL(context.request.url);
  return handle(context, {
    url: u.searchParams.get("url") || null,
    language: cleanOptional(u.searchParams.get("language")),
    target: cleanOptional(u.searchParams.get("target")),
  });
}

export async function onRequestPost(context) {
  const parsed = await readOptionalJsonBody(context.request);
  if (!parsed.ok) {
    return accessJson(
      { error: "invalid_json", note: "POST { url, language?, target? }." },
      400,
      CORS
    );
  }
  const data = parsed.data;
  return handle(context, {
    url: data?.url || null,
    language: cleanOptional(data?.language),
    target: cleanOptional(data?.target),
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
        note: "Provide a public HTTPS URL to a research-paper PDF.",
      },
      400,
      CORS
    );
  }
  if (!isSafeHttpUrl(input.url)) {
    return accessJson(
      { tool: PRODUCT_SLUG, error: "unsafe_url", note: "url must be a public HTTPS URL." },
      400,
      CORS
    );
  }

  const generated = await generateImplementation(env, input);
  if (!generated.ok) {
    return accessJson({ tool: PRODUCT_SLUG, ...generated.body }, generated.status, CORS);
  }

  const verdict = validatePackage(generated.data);
  if (!verdict.pass) {
    if (verifiedPayment && paymentHeader) {
      await recordX402PaymentAttempt(
        env,
        paymentHeader,
        { route: requestUrl.pathname, failure_reason: "validator_failed", requestId: readRequestId(request) },
        verifiedPayment,
        null
      );
    }
    return accessJson(
      {
        tool: PRODUCT_SLUG,
        error: "validator_failed",
        settled: false,
        charged: false,
        failures: verdict.failures,
        note: "The implementation package failed deterministic structure/safety validation, so payment was not settled.",
      },
      422,
      CORS
    );
  }

  const body = {
    tool: PRODUCT_SLUG,
    source_url: input.url,
    paper: generated.data.paper,
    implementation: generated.data.implementation,
    assumptions: generated.data.assumptions,
    fidelity: generated.data.fidelity,
    execution_verified: false,
    attestation: {
      basis: "source-grounded-implementation-package",
      claims: [
        "implementation package schema complete",
        "source and test files present",
        "repository paths are relative and traversal-safe",
        "paper-supported details separated from inferred engineering choices",
      ],
      disclaimer:
        "Generated implementation package. Structure is validated, but code has not been executed by this endpoint; execution_verified is false.",
    },
    model_usage: generated.usage || null,
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

async function generateImplementation(env, input) {
  const language = input.language || "choose the language best suited to the paper";
  const target = input.target || "a minimal faithful reference implementation";
  const system =
    "You turn research papers into implementation packages for coding agents. Read the paper carefully. Recover its objective, architecture, algorithms, equations, dependencies, and experimental requirements. Produce actual source files and tests, not pseudocode-only notes. Never pretend an engineering choice was specified by the paper when it was not: record every such choice under assumptions and fidelity.inferred_choices. Put details that cannot be recovered under fidelity.unresolved. Do not claim execution. Return only the requested JSON schema.";
  const instruction =
    `Implement this research paper as ${target}. Preferred language: ${language}. ` +
    "Keep the package compact enough for another coding agent to consume, but include the load-bearing implementation files and tests required to reproduce the core method.";

  const result = await runExtractPipeline(env, {
    url: input.url,
    maxBytes: MAX_PAPER_BYTES,
    system,
    instruction,
    schema: PAPER_TO_CODE_SCHEMA,
    pickMime: () => "application/pdf",
    filenameFromUrl: () => "paper.pdf",
    fetcher: (url, opts) => fetchWithTimeout(url, opts, PAPER_FETCH_TIMEOUT_MS),
  });

  if (!result.ok) return result;
  if (!result.data) {
    return {
      ok: false,
      status: 502,
      body: { error: "structured_parse_failed", note: "Model did not return a valid implementation package." },
    };
  }
  return { ok: true, data: result.data, usage: result.usage || null };
}

function validatePackage(pkg) {
  const failures = [];
  if (!pkg || typeof pkg !== "object") return { pass: false, failures: ["output_not_object"] };
  if (!String(pkg.paper?.objective || "").trim()) failures.push("paper_objective_missing");
  if (!Array.isArray(pkg.paper?.contributions)) failures.push("paper_contributions_missing");
  if (!String(pkg.implementation?.language || "").trim()) failures.push("language_missing");
  if (!Array.isArray(pkg.implementation?.architecture) || !pkg.implementation.architecture.length) {
    failures.push("architecture_missing");
  }
  if (!Array.isArray(pkg.implementation?.algorithms) || !pkg.implementation.algorithms.length) {
    failures.push("algorithms_missing");
  }
  if (!Array.isArray(pkg.implementation?.files) || !pkg.implementation.files.length) {
    failures.push("implementation_files_missing");
  }
  if (!Array.isArray(pkg.implementation?.tests) || !pkg.implementation.tests.length) {
    failures.push("tests_missing");
  }
  if (!Array.isArray(pkg.implementation?.install_commands) || !pkg.implementation.install_commands.length) {
    failures.push("install_commands_missing");
  }
  if (!Array.isArray(pkg.implementation?.run_commands) || !pkg.implementation.run_commands.length) {
    failures.push("run_commands_missing");
  }
  if (!Array.isArray(pkg.assumptions)) failures.push("assumptions_missing");
  if (!Array.isArray(pkg.fidelity?.paper_supported)) failures.push("paper_supported_missing");
  if (!Array.isArray(pkg.fidelity?.inferred_choices)) failures.push("inferred_choices_missing");
  if (!Array.isArray(pkg.fidelity?.unresolved)) failures.push("unresolved_missing");
  if (pkg.execution_verified !== false) failures.push("execution_verified_must_be_false");

  const allFiles = [
    ...(Array.isArray(pkg.implementation?.files) ? pkg.implementation.files : []),
    ...(Array.isArray(pkg.implementation?.tests) ? pkg.implementation.tests : []),
  ];
  const seen = new Set();
  for (const file of allFiles) {
    const path = String(file?.path || "");
    const code = String(file?.code || "");
    if (!safeRelativePath(path)) failures.push(`unsafe_path:${path}`);
    if (!code.trim()) failures.push(`empty_code:${path}`);
    if (seen.has(path)) failures.push(`duplicate_path:${path}`);
    seen.add(path);
  }

  return { pass: failures.length === 0, failures };
}

function safeRelativePath(path) {
  if (!path || path.startsWith("/") || path.startsWith("\\")) return false;
  const parts = path.replace(/\\/g, "/").split("/");
  return parts.every((part) => part && part !== "." && part !== "..");
}

function cleanOptional(value) {
  const s = String(value || "").trim();
  return s ? s.slice(0, 120) : null;
}
