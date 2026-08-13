import { runExtractPipeline } from "./llm-workersai-legacy.js";
import { fetchWithTimeout } from "./resilience.js";

const PAPER_CODE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    repository: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        language: { type: "string" },
        framework: { type: "string" },
        run: { type: "string" },
        test: { type: "string" }
      },
      required: ["name", "language", "framework", "run", "test"]
    },
    implementation_plan: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
    dependencies: { type: "array", items: { type: "string" } },
    files: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string" }, purpose: { type: "string" }, content: { type: "string" } },
        required: ["path", "purpose", "content"]
      }
    },
    source_grounding: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { implementation: { type: "string" }, paper_basis: { type: "string" }, confidence: { type: "string" } },
        required: ["implementation", "paper_basis", "confidence"]
      }
    }
  },
  required: ["repository", "implementation_plan", "assumptions", "dependencies", "files", "source_grounding"]
};

export async function runPaperToCodePipeline(env, { paperUrl, targetLanguage = "python", framework = "", repositoryName = "paper-implementation", maxBytes }) {
  const result = await runExtractPipeline(env, {
    url: paperUrl,
    maxBytes,
    system:
      "You are a paper-to-code refinery for autonomous coding agents. Read the research paper and reconstruct a small runnable implementation repository. Recover architecture, algorithms and equations first; then produce implementation source and real tests. Never present inferred implementation choices as author-stated facts: put them in assumptions. Ground implementation decisions in paper sections, equations, tables, algorithms, or experiments. Return only the requested JSON.",
    instruction: `Target language: ${targetLanguage}. Framework: ${framework || "unspecified"}. Repository name: ${repositoryName}. Keep the package focused and under 12 files. Include at least one implementation source file and one test file.`,
    schema: PAPER_CODE_SCHEMA,
    pickMime,
    filenameFromUrl,
    fetcher: (url, opts) => fetchWithTimeout(url, opts, 20000)
  });
  if (!result.ok) return result;
  result.data.repository = {
    ...result.data.repository,
    name: repositoryName,
    language: targetLanguage,
    framework
  };
  return {
    ...result,
    usage: { ...(result.usage || {}), stages: ["paper_analysis", "implementation_planning", "repository_generation"] }
  };
}

function pickMime(contentType, url) {
  const ct = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (ct && ct !== "application/octet-stream") return ct;
  return String(url).toLowerCase().includes(".pdf") ? "application/pdf" : "text/html";
}

function filenameFromUrl(url, mime) {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (name && /\.[a-z0-9]{2,6}$/i.test(name)) return name;
  } catch {}
  return mime === "application/pdf" ? "paper.pdf" : "paper.html";
}
