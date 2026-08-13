#!/usr/bin/env node
await import("./discovery-compat-selftest-legacy.mjs");
await import("../test/refinery-offerings.test.mjs");

const contentRoute = await import("../functions/api/bar/x402/analyze-video-audio-and-pdfs.js");
const paperRoute = await import("../functions/api/bar/x402/turn-paper-into-code.js");
if (typeof contentRoute.onRequestGet !== "function" || typeof contentRoute.onRequestPost !== "function") {
  throw new Error("Content Analysis route exports are missing");
}
if (typeof paperRoute.onRequestGet !== "function" || typeof paperRoute.onRequestPost !== "function") {
  throw new Error("Paper-to-Code route exports are missing");
}

const { validatePaperCodePackage } = await import("../functions/_lib/paper-code-validate.js");
const good = validatePaperCodePackage({
  repository: { name: "paper", language: "python", framework: "", run: "python src/main.py", test: "python -m pytest" },
  implementation_plan: ["implement the paper"],
  assumptions: [],
  dependencies: [],
  files: [
    { path: "src/main.py", purpose: "implementation", content: "def main():\n    return 1\n" },
    { path: "tests/test_main.py", purpose: "test", content: "def test_main():\n    assert True\n" }
  ],
  source_grounding: [{ implementation: "core", paper_basis: "method section", confidence: "high" }]
});
if (!good.pass) throw new Error(`valid paper package rejected: ${JSON.stringify(good.failures)}`);
const bad = validatePaperCodePackage({ ...{}, files: [] });
if (bad.pass) throw new Error("invalid paper package unexpectedly passed");

console.log("refinery route imports + package validator: ok");
