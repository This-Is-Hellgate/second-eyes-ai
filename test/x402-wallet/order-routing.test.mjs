#!/usr/bin/env node
// Unit test for MCP order_service session-less x402 routing. No network, no spend.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CAPABILITY_PRICES_USD,
  INPUT_REQUIRED_SLUGS,
  x402RouteSlug,
  x402ServicePath,
} from "../../packages/secondeye-mcp/src/x402-wallet.js";
import { X402_TWIN_SLUGS } from "../../functions/_lib/lounge/constants.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const X402_DIR = join(ROOT, "functions/api/bar/x402");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const staticRouteFiles = new Set(
  readdirSync(X402_DIR)
    .filter((f) => f.endsWith(".js") && f !== "[slug].js")
    .map((f) => f.replace(/\.js$/, ""))
);
function routeIsLive(routeSlug) {
  return staticRouteFiles.has(routeSlug) || X402_TWIN_SLUGS.has(routeSlug);
}

console.log("\n[1] Every MCP catalog slug resolves to a live session-less x402 route");
for (const slug of Object.keys(CAPABILITY_PRICES_USD)) {
  const path = x402ServicePath(slug);
  check(`"${slug}" resolves to /api/bar/x402`, typeof path === "string" && path.startsWith("/api/bar/x402/"), JSON.stringify(path));
  const routeSlug = x402RouteSlug(slug);
  check(`"${slug}" → "${routeSlug}" is live`, routeIsLive(routeSlug), "not static-file and not in X402_TWIN_SLUGS");
}

console.log("\n[2] Confirmed refinery offerings replace the old product slugs");
check("Content Analysis is in the MCP catalog", CAPABILITY_PRICES_USD["analyze-video-audio-and-pdfs"] === 0.05);
check("Paper-to-Code is in the MCP catalog", CAPABILITY_PRICES_USD["turn-paper-into-code"] === 0.25);
check("old transcribe-extract catalog slug is gone", !("transcribe-extract" in CAPABILITY_PRICES_USD));
check("old doc-extract catalog slug is gone", !("doc-extract" in CAPABILITY_PRICES_USD));
check("Content Analysis requires caller input", INPUT_REQUIRED_SLUGS.has("analyze-video-audio-and-pdfs"));
check("Paper-to-Code requires caller input", INPUT_REQUIRED_SLUGS.has("turn-paper-into-code"));
check("Content Analysis path is descriptive", x402ServicePath("analyze-video-audio-and-pdfs") === "/api/bar/x402/analyze-video-audio-and-pdfs");
check("Paper-to-Code path is descriptive", x402ServicePath("turn-paper-into-code") === "/api/bar/x402/turn-paper-into-code");
check("legacy transcribe-extract resolves to null", x402ServicePath("transcribe-extract") === null);
check("legacy doc-extract resolves to null", x402ServicePath("doc-extract") === null);

console.log("\n[3] order_service must not target session-gated service routes");
const indexSrc = readFileSync(join(ROOT, "packages/secondeye-mcp/src/index.js"), "utf8");
const orderBlock = indexSrc.slice(indexSrc.indexOf('"order_service"'), indexSrc.indexOf('"leave_with_receipt"'));
check("order_service uses x402ServicePath", /x402ServicePath\(slug\)/.test(orderBlock));
check("order_service does not hard-code session route", !/\/api\/bar\/services\/\$\{slug\}/.test(orderBlock));
check("MCP copy names Content Analysis route", /analyze-video-audio-and-pdfs/.test(orderBlock));
check("MCP copy names Paper-to-Code route", /turn-paper-into-code/.test(orderBlock));
check("MCP copy does not direct buyers to legacy transcribe URL", !/api\/bar\/x402\/transcribe(?:\s|`|\")/.test(orderBlock));
check("MCP copy does not direct buyers to legacy extract URL", !/api\/bar\/x402\/extract(?:\s|`|\")/.test(orderBlock));

console.log("\n[4] github_mcp_401_fix still uses session-less autopay");
const fixBlock = indexSrc.slice(indexSrc.indexOf('"github_mcp_401_fix"'));
check("github_mcp_401_fix calls payAndRetryService", /payAndRetryService\(/.test(fixBlock));
check("github_mcp_401_fix resolves x402ServicePath", /x402ServicePath\(/.test(fixBlock));
check("github_mcp_401_fix does not hard-call service route", !/\/api\/bar\/services\/mcp-wiring/.test(fixBlock));

if (failures > 0) {
  console.error(`x402-wallet order routing: ${failures} FAILED`);
  process.exit(1);
}
console.log("x402-wallet order routing: all checks passed");
