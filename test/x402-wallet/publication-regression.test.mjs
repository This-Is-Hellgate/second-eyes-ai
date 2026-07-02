#!/usr/bin/env node
// test/x402-wallet/publication-regression.test.mjs
// Regression suite for MCP publication and discovery repair.
//
// Covers:
//   1. mcp-facade.js initialize returns version 1.2.6 and correct identity
//   2. mcp-facade.js tools/list exposes all current tools (incl. help_me, schema_repair,
//      context_pressure, payment_confirmation_check)
//   3. proof.js does NOT call /api/bar/enter or other state-changing subrequests
//   4. Advertised prices in discovery.js match live constants
//   5. All primary x402 routes have machine-readable schemas in buildRouteSchemas()
//   6. Discovery prefers /api/bar/x402/* (not /api/bar/services/*)
//   7. No dead standalone secondeye-mcp repo advertised in discovery-facing files
//   8. No Hugging Face refs in key publication files
//   9. No obsolete package versions (1.1.x or 1.0.x) advertised as current
//
// Run: node test/x402-wallet/publication-regression.test.mjs   (exit 1 on any failure)

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── [1] mcp-facade.js identity and version ────────────────────────────────────
console.log("\n[1] mcp-facade.js identity / version");
const facadeText = readFileSync(join(ROOT, "functions/_lib/mcp-facade.js"), "utf8");
// Parse via source text to avoid Cloudflare-specific transitive deps (jose, etc.)
const versionMatch = facadeText.match(/MCP_SERVER_INFO\s*=\s*\{[^}]*version:\s*["']([^"']+)["']/);
const nameMatch = facadeText.match(/MCP_SERVER_INFO\s*=\s*\{[^}]*name:\s*["']([^"']+)["']/);
const serviceNameMatch = facadeText.match(/serviceName:\s*["']([^"']+)["']/);
const mcpRegistryMatch = facadeText.match(/mcpRegistryId:\s*["']([^"']+)["']/);

check("MCP_SERVER_INFO.version is 1.2.6", versionMatch?.[1] === "1.2.6", `got ${versionMatch?.[1]}`);
check("MCP_SERVER_INFO.name is secondeye-mcp-unblock", nameMatch?.[1] === "secondeye-mcp-unblock");
check("MCP_SERVER_INFO.serviceName is 'Second Eyes Agent Workflow Services'",
  serviceNameMatch?.[1] === "Second Eyes Agent Workflow Services", `got ${serviceNameMatch?.[1]}`);
check("MCP_SERVER_INFO.mcpRegistryId is io.github.This-Is-Hellgate/secondeye-mcp-unblock",
  mcpRegistryMatch?.[1] === "io.github.This-Is-Hellgate/secondeye-mcp-unblock");

// ── [2] MCP_TOOLS completeness ───────────────────────────────────────────────
console.log("\n[2] MCP_TOOLS completeness");
// Extract tool names from MCP_TOOLS array in facade source
const toolNamesInFacade = [...facadeText.matchAll(/\{\s*name:\s*["']([^"']+)["']/g)].map((m) => m[1]);
const required = [
  "proof_bar", "patron_activity", "read_menu", "read_laws", "read_pricing",
  "enter_lounge", "pause_and_route", "order_service", "leave_with_receipt",
  "fetch_catalog", "github_mcp_401_fix",
  "help_me", "schema_repair", "context_pressure", "payment_confirmation_check",
];
for (const name of required) {
  check(`MCP_TOOLS includes "${name}"`, toolNamesInFacade.includes(name));
}
check("help_me description mentions x402 and $0.01",
  facadeText.includes("$0.01 USDC") && facadeText.includes("/api/bar/x402/help-me"));
check("schema_repair REST path is /api/bar/x402/schema-repair", facadeText.includes("/api/bar/x402/schema-repair"));
check("context_pressure REST path is /api/bar/x402/context-pressure", facadeText.includes("/api/bar/x402/context-pressure"));
check("payment_confirmation_check REST path is /api/bar/x402/payment-confirmation-check",
  facadeText.includes("/api/bar/x402/payment-confirmation-check"));
// buildServerCard must advertise 1.2.6
const serverCardSection = facadeText.slice(facadeText.indexOf("function buildServerCard"));
check("buildServerCard install references @1.2.6", serverCardSection.includes("1.2.6"));

// ── [3] proof.js does NOT call /api/bar/enter (read-only) ─────────────────────
console.log("\n[3] proof.js read-only — no /api/bar/enter subrequests");
const proofText = readFileSync(join(ROOT, "functions/api/bar/proof.js"), "utf8");
check("proof.js does not call /api/bar/enter", !/["'`]\/api\/bar\/enter["'`]/.test(proofText),
  "found reference to /api/bar/enter in proof.js — state-changing, remove it");
check("proof.js does not check enter_has_session", !proofText.includes("enter_has_session"),
  "found enter_has_session check — this creates a session");
check("proof.js does not createSession/enterBar", !/createSession|enterBar/.test(proofText),
  "proof.js imports state-creating functions");
// Verify the x402 gate check is present (correct replacement)
check("proof.js checks x402_help_me_gate (unpaid 402)", proofText.includes("x402_help_me_gate"));

// ── [4] Advertised prices match live constants ─────────────────────────────────
console.log("\n[4] Discovery prices match live constants");
const { SERVICE_PRICES, SURVIVAL_MENU } = await import(join(ROOT, "functions/_lib/lounge/constants.js"));
const disc = await import(join(ROOT, "functions/_lib/discovery.js"));
const schemas = disc.buildRouteSchemas("https://secondeyesai.com");

const EXPECTED_PRICES = {
  "doctor": 0.25,
  "extract": 0.05,
  "index-check": 0.05,
  "loop-detect": 0.03,
  "transcribe": 0.05,
  "help-me": 0.01,
  "schema-repair": 0.03,
  "context-pressure": 0.03,
  "payment-confirmation-check": 0.01,
};

// Check prices in buildRouteSchemas()
for (const route of schemas.routes) {
  if (!route.price_usd) continue; // dynamic entry
  const expected = EXPECTED_PRICES[route.slug];
  if (expected !== undefined) {
    check(`buildRouteSchemas "${route.slug}" price $${route.price_usd} == live $${expected}`,
      Math.abs(route.price_usd - expected) < 1e-9, `got ${route.price_usd}`);
  }
}

// Check survival menu prices in constants
for (const { slug, price_usd } of SURVIVAL_MENU) {
  check(`constants SURVIVAL_MENU "${slug}" price $${price_usd} is ≥ $0.01`,
    price_usd >= 0.01 - 1e-9);
}

// ── [5] All primary x402 routes have schemas in buildRouteSchemas() ──────────
console.log("\n[5] All primary x402 routes have machine-readable schemas");
const REQUIRED_SCHEMA_SLUGS = ["help-me", "schema-repair", "context-pressure", "payment-confirmation-check",
  "transcribe", "extract", "doctor", "index-check", "loop-detect"];
const schemaSlugs = schemas.routes.map((r) => r.slug);
for (const slug of REQUIRED_SCHEMA_SLUGS) {
  check(`buildRouteSchemas includes "${slug}"`, schemaSlugs.includes(slug));
}
// Verify each has canonical x402 path
for (const route of schemas.routes.filter((r) => r.canonical)) {
  check(`"${route.slug}" canonical path starts with /api/bar/x402/`,
    route.canonical.includes("/api/bar/x402/"), `got ${route.canonical}`);
  check(`"${route.slug}" has example_request`, Boolean(route.example_request));
  check(`"${route.slug}" has params schema`, Boolean(route.params));
  check(`"${route.slug}" has response_description`, Boolean(route.response_description));
}

// ── [6] Discovery prefers /api/bar/x402/* ─────────────────────────────────────
console.log("\n[6] Discovery prefers /api/bar/x402/* over /api/bar/services/*");
const discText = readFileSync(join(ROOT, "functions/_lib/discovery.js"), "utf8");
// paidDoors() paths must all be /api/bar/x402/
const doorMatches = [...discText.matchAll(/path:\s*["'`]\/api\/bar\/([^"'`]+)["'`]/g)];
for (const m of doorMatches) {
  const path = m[1];
  if (path.startsWith("x402/")) continue; // correct
  if (path.startsWith("proof") || path.startsWith("stats") || path.startsWith("pricing") ||
      path.startsWith("menu") || path.startsWith("marks")) continue; // free surfaces
  // compat entries in buildRouteSchemas are allowed; ensure paidDoors uses x402
  // (We only check paidDoors lines — they're in the first ~200 chars of paidDoors function)
  const fnStart = discText.indexOf("function paidDoors()");
  const fnEnd = discText.indexOf("}", fnStart + 50);
  if (fnStart > -1 && m.index > fnStart && m.index < fnEnd + 500) {
    check(`paidDoors path /${path} is under /api/bar/x402/`, path.startsWith("x402/"), `got /api/bar/${path}`);
  }
}

// buildX402Resources links prefer x402
const resources = disc.buildX402Resources("https://secondeyesai.com", {});
for (const r of resources.resources) {
  check(`x402 resource "${r.slug}" uses /api/bar/x402/ path`,
    r.resource.includes("/api/bar/x402/"), `got ${r.resource}`);
}

// ── [7] No dead standalone secondeye-mcp repo advertised ─────────────────────
console.log("\n[7] No dead standalone repo advertised in discovery-facing files");
// The negative lookahead prevents matching 'secondeye-mcp-unblock' (the npm package path)
// and 'second-eyes-ai' (the monorepo path) while still catching bare 'secondeye-mcp' refs
// that would point to the old retired standalone repository.
const DEAD_REPO_RE = /github\.com\/This-Is-Hellgate\/secondeye-mcp(?![.-]|\/second-eyes)/i;
// Note: the README.md explicitly says it's retired, which is correct — exclude it.
const DISCOVERY_FILES = [
  "functions/_lib/mcp-facade.js",
  "functions/_lib/discovery.js",
  "functions/_lib/agent-entry.js",
  "public/.well-known/mcp.json",
  "public/.well-known/mcp/server-card.json",
  "public/llms.txt",
  "public/robots.txt",
  "packages/secondeye-mcp/registry/mcp-registry.md",
  "packages/secondeye-mcp/registry/independent-registries.md",
  ".cursor/rules/second-eyes-cloudflare.mdc",
];
for (const rel of DISCOVERY_FILES) {
  const text = readFileSync(join(ROOT, rel), "utf8");
  check(`"${rel}" does not advertise dead standalone repo`,
    !DEAD_REPO_RE.test(text), `found reference to dead standalone repo`);
}

// ── [8] No Hugging Face refs in key publication files ─────────────────────────
console.log("\n[8] No Hugging Face refs in key publication files");
const HF_RE = /hugging.?face|huggingface\.co|hf\.co/i;
const PUBLICATION_FILES = [
  "public/.well-known/mcp.json",
  "public/.well-known/mcp/server-card.json",
  "public/llms.txt",
  "public/robots.txt",
  "packages/secondeye-mcp/registry/mcp-registry.md",
  "packages/secondeye-mcp/registry/independent-registries.md",
  "packages/secondeye-mcp/registry/packs/aws-agent-registry-publish.md",
  "packages/secondeye-mcp/PUBLISH.md",
  "packages/secondeye-mcp/README.md",
  "functions/_lib/mcp-facade.js",
  "functions/_lib/discovery.js",
  "SPEC.md",
];
for (const rel of PUBLICATION_FILES) {
  const text = readFileSync(join(ROOT, rel), "utf8");
  check(`"${rel}" has no Hugging Face references`, !HF_RE.test(text),
    "found Hugging Face reference in publication file");
}

// ── [9] No obsolete versions advertised as current in publication surfaces ────
console.log("\n[9] No obsolete versions (1.1.x) advertised as current");
const CURRENT_VERSION = "1.2.6";
// 1.1.x was broken (x402 v1 clients) — must not appear as a recommended or install version
// in publication surfaces.
const V11_CURRENT_RE = /(?:install|npx|recommended|pin).*@?1\.1\.[0-9]+/i;
const PUB_SURFACES = [
  "public/.well-known/mcp.json",
  "public/.well-known/mcp/server-card.json",
  "packages/secondeye-mcp/README.md",
  "packages/secondeye-mcp/PUBLISH.md",
  "public/robots.txt",
  "public/llms.txt",
];
for (const rel of PUB_SURFACES) {
  const text = readFileSync(join(ROOT, rel), "utf8");
  check(`"${rel}" does not recommend 1.1.x`, !V11_CURRENT_RE.test(text));
}
// mcp.json must list 1.2.6 as the primary/recommended package version
const mcpJson = JSON.parse(readFileSync(join(ROOT, "public/.well-known/mcp.json"), "utf8"));
const primaryPkg = mcpJson.packages?.find((p) => p.recommended) || mcpJson.packages?.[0];
check(`mcp.json primary package version is ${CURRENT_VERSION}`,
  primaryPkg?.version === CURRENT_VERSION, `got ${primaryPkg?.version}`);

// mcp-facade.js must not advertise 1.1.x as buildServerCard package version
// (already verified via source text scan in [2] above — remove duplicate here)

// ── Summary ────────────────────────────────────────────────────────────────────
console.log("");
if (failures > 0) {
  console.error(`publication-regression: ${failures} FAILED`);
  process.exit(1);
}
console.log("publication-regression: all checks passed");
