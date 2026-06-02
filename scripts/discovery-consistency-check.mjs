#!/usr/bin/env node
/**
 * Discovery consistency guard — fails CI when static discovery surfaces drift
 * from the canonical npm package or from x402 v2 / CAIP-2 requirements.
 *
 * Source of truth: packages/secondeye-mcp/package.json (the published version).
 * Guards against the 1.1.0 / x402 v1 / network "base" regression that left
 * /.well-known/mcp.json contradicting llms.txt and the live 402 payloads.
 *
 * No deps — Node built-ins only. Exit 1 on any failure.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const X402_VERSION = 2;
const NETWORK = "eip155:8453";
const SCHEME = "ExactEvmScheme";
const REQUIREMENTS_HEADER = "PAYMENT-REQUIRED";
const PAYMENT_HEADER = "PAYMENT-SIGNATURE";
const LEGACY_VERSION = "1.0.5";

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);

function readJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
}

// Canonical version + x402 deps come from the published npm package.
const pkg = readJson("packages/secondeye-mcp/package.json");
const CANONICAL_VERSION = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(CANONICAL_VERSION)) {
  fail("package.json", `version not semver: ${CANONICAL_VERSION}`);
}

// server.json (registry manifest) must match the package version on top + every package entry.
const serverJson = readJson("packages/secondeye-mcp/server.json");
if (serverJson.version !== CANONICAL_VERSION) {
  fail("server.json", `version ${serverJson.version} != package ${CANONICAL_VERSION}`);
}
for (const p of serverJson.packages || []) {
  if (p.version !== CANONICAL_VERSION) {
    fail("server.json", `package ${p.identifier}@${p.version} != ${CANONICAL_VERSION}`);
  }
}

// Helper: assert a discovery file advertises the canonical version as recommended/top
// and never re-introduces x402 v1 or network "base".
function checkX402Block(where, block) {
  if (!block) return fail(where, "missing payment/how_to_pay block");
  if (block.x402Version !== X402_VERSION) {
    fail(where, `x402Version ${block.x402Version} != ${X402_VERSION}`);
  }
  if (block.network !== NETWORK) {
    fail(where, `network ${block.network} != ${NETWORK}`);
  }
}

function checkNoLegacyStrings(where, raw) {
  if (/ExactEvmSchemeV1/.test(raw)) fail(where, "references ExactEvmSchemeV1 (x402 v1)");
  if (/x402Version"\s*:\s*1\b/.test(raw)) fail(where, "declares x402Version 1");
  if (/"network"\s*:\s*"base"/.test(raw)) fail(where, 'declares network "base" (use eip155:8453)');
}

function checkPackages(where, packages) {
  const versions = (packages || []).map((p) => p.version);
  if (!versions.includes(CANONICAL_VERSION)) {
    fail(where, `no package pinned to canonical ${CANONICAL_VERSION} (has ${versions.join(", ")})`);
  }
  // Any non-canonical, non-legacy version is drift (e.g. the broken 1.1.x).
  for (const v of versions) {
    if (v !== CANONICAL_VERSION && v !== LEGACY_VERSION) {
      fail(where, `unexpected package version ${v} (only ${CANONICAL_VERSION} + legacy ${LEGACY_VERSION} allowed)`);
    }
  }
}

// --- public/.well-known/mcp.json ---
{
  const where = "mcp.json";
  const raw = readFileSync(join(ROOT, "public/.well-known/mcp.json"), "utf8");
  const mcp = JSON.parse(raw);
  if (mcp.version !== CANONICAL_VERSION) {
    fail(where, `version ${mcp.version} != canonical ${CANONICAL_VERSION}`);
  }
  checkX402Block(where, mcp.payment);
  if (mcp.payment?.scheme !== SCHEME) fail(where, `payment.scheme != ${SCHEME}`);
  if (mcp.payment?.payment_header !== PAYMENT_HEADER) fail(where, `payment.payment_header != ${PAYMENT_HEADER}`);
  if (mcp.payment?.requirements_header !== REQUIREMENTS_HEADER) fail(where, `payment.requirements_header != ${REQUIREMENTS_HEADER}`);
  checkPackages(where, mcp.packages);
  checkNoLegacyStrings(where, raw);
}

// --- public/.well-known/mcp/server-card.json ---
{
  const where = "server-card.json";
  const raw = readFileSync(join(ROOT, "public/.well-known/mcp/server-card.json"), "utf8");
  const card = JSON.parse(raw);
  if (card.serverInfo?.version !== CANONICAL_VERSION) {
    fail(where, `serverInfo.version ${card.serverInfo?.version} != ${CANONICAL_VERSION}`);
  }
  checkX402Block(where, card.how_to_pay);
  checkPackages(where, card.packages);
  checkNoLegacyStrings(where, raw);
}

// --- public/.well-known/agent-card.json ---
{
  const where = "agent-card.json";
  const raw = readFileSync(join(ROOT, "public/.well-known/agent-card.json"), "utf8");
  const card = JSON.parse(raw);
  checkX402Block(where, card.how_to_pay);
  if (card.how_to_pay?.scheme !== SCHEME) fail(where, `how_to_pay.scheme != ${SCHEME}`);
  if (card.how_to_pay?.mcp_autopay_version !== CANONICAL_VERSION) {
    fail(where, `how_to_pay.mcp_autopay_version ${card.how_to_pay?.mcp_autopay_version} != ${CANONICAL_VERSION}`);
  }
  checkX402Block(`${where} (survival_menu)`, card.survival_menu?.payment);
  checkNoLegacyStrings(where, raw);
}

// --- public/.well-known/menu.json ---
{
  const where = "menu.json";
  const raw = readFileSync(join(ROOT, "public/.well-known/menu.json"), "utf8");
  const menu = JSON.parse(raw);
  checkX402Block(where, menu.payment);
  checkNoLegacyStrings(where, raw);
}

// --- public/llms.txt ---
{
  const where = "llms.txt";
  const raw = readFileSync(join(ROOT, "public/llms.txt"), "utf8");
  if (!raw.includes(NETWORK)) fail(where, `does not mention ${NETWORK}`);
  if (!new RegExp(`@secondeyes/mcp-unblock@${CANONICAL_VERSION.replace(/\./g, "\\.")}`).test(raw)) {
    fail(where, `does not pin autopay path to @${CANONICAL_VERSION}`);
  }
  checkNoLegacyStrings(where, raw);
}

// --- packages/secondeye-mcp/README.md (the published buyer-facing surface) ---
{
  const where = "README.md";
  const raw = readFileSync(join(ROOT, "packages/secondeye-mcp/README.md"), "utf8");
  const canonRe = new RegExp(`@secondeyes/mcp-unblock@${CANONICAL_VERSION.replace(/\./g, "\\.")}\\b`);
  if (!canonRe.test(raw)) {
    fail(where, `does not document the canonical autopay install @${CANONICAL_VERSION}`);
  }
  // The 1.1.x line registered x402 v1 clients that fail prod 402s. Allow it only
  // when prefixed by a negation ("not", "don't", "avoid", "broken") so a warning
  // is fine but a bare install instruction is not.
  for (const m of raw.matchAll(/@secondeyes\/mcp-unblock@(1\.1\.\d+)/g)) {
    const preceding = raw.slice(Math.max(0, m.index - 60), m.index).toLowerCase();
    if (!/(not|n['’]t|never|avoid|broken|do not)/.test(preceding)) {
      fail(where, `presents @${m[1]} as a usable install (1.1.x is broken — keep only as a negated warning)`);
    }
  }
}

// --- packages/secondeye-mcp/src/index.js (MCP runtime version must not drift) ---
{
  const where = "src/index.js";
  const raw = readFileSync(join(ROOT, "packages/secondeye-mcp/src/index.js"), "utf8");
  // A hardcoded "version": "x.y.z" in the McpServer constructor is drift unless
  // it equals canonical. Reading it from package.json (no literal) is preferred.
  const hardcoded = raw.match(/version:\s*"(\d+\.\d+\.\d+)"/);
  if (hardcoded && hardcoded[1] !== CANONICAL_VERSION) {
    fail(where, `McpServer version "${hardcoded[1]}" != canonical ${CANONICAL_VERSION} (prefer importing package.json version)`);
  }
}

// --- PRICE DRIFT GUARD ---------------------------------------------------------
// Canonical survival prices live in functions/_lib/lounge/constants.js. The static
// discovery surfaces (menu.json, mcp.json, agent-card.json) duplicate them and the
// session-less x402 routes each hardcode their own PRICE_USD that MUST equal what is
// advertised. This guard fails CI when an advertised price drifts from canonical, so
// the charged x402 amount can never silently diverge from what the menus promise.
{
  const constants = await import("../functions/_lib/lounge/constants.js");
  const { SURVIVAL_MENU, SERVICE_PRICES, SURVIVAL_PRICE_MIN_USD, SURVIVAL_PRICE_MAX_USD } = constants;

  // Canonical per-slug survival price (SERVICE_PRICES is the live source for the route).
  const canonical = new Map();
  for (const { slug } of SURVIVAL_MENU) {
    const p = SERVICE_PRICES[slug]?.price_usd;
    if (typeof p === "number") canonical.set(slug, p);
  }

  // Every canonical survival price must sit inside the advertised range.
  for (const [slug, price] of canonical) {
    if (price < SURVIVAL_PRICE_MIN_USD || price > SURVIVAL_PRICE_MAX_USD) {
      fail("constants.js", `survival ${slug} ${price} outside advertised range ${SURVIVAL_PRICE_MIN_USD}–${SURVIVAL_PRICE_MAX_USD}`);
    }
  }

  // Static survival menus must match canonical per slug + advertised range.
  function checkStaticSurvival(where, range, items) {
    if (!range) {
      fail(where, "missing survival price_range_usd");
    } else {
      if (range.min !== SURVIVAL_PRICE_MIN_USD) fail(where, `survival range min ${range.min} != ${SURVIVAL_PRICE_MIN_USD}`);
      if (range.max !== SURVIVAL_PRICE_MAX_USD) fail(where, `survival range max ${range.max} != ${SURVIVAL_PRICE_MAX_USD}`);
    }
    for (const item of items || []) {
      const want = canonical.get(item.slug);
      if (want === undefined) continue;
      if (item.price_usd !== want) {
        fail(where, `survival ${item.slug} price_usd ${item.price_usd} != canonical ${want}`);
      }
    }
  }

  const menuJson = readJson("public/.well-known/menu.json");
  checkStaticSurvival("menu.json (survival)", menuJson.price_range_usd, menuJson.items);

  const mcpJson = readJson("public/.well-known/mcp.json");
  checkStaticSurvival("mcp.json (survival)", mcpJson.survival_menu?.price_range_usd, mcpJson.survival_menu?.items);

  const agentCard = readJson("public/.well-known/agent-card.json");
  checkStaticSurvival("agent-card.json (survival)", agentCard.survival_menu?.price_range_usd, agentCard.survival_menu?.items);

  // Session-less x402 routes hardcode PRICE_USD — assert each equals canonical (for
  // survival twins) or the standalone door price advertised by aws-agent-survival.
  function routePrice(rel) {
    const raw = readFileSync(join(ROOT, rel), "utf8");
    const m = raw.match(/const PRICE_USD\s*=\s*([\d.]+)/);
    return m ? Number(m[1]) : null;
  }

  // Standalone-door prices advertised by the AWS survival map must match each route's PRICE_USD.
  const standalone = {
    "functions/api/bar/x402/peril-router.js": 0.01,
    "functions/api/bar/x402/transcribe.js": 0.05,
    "functions/api/bar/x402/extract.js": 0.05,
    "functions/api/bar/x402/index-check.js": 0.05,
    "functions/api/bar/x402/doctor.js": 0.25,
    "functions/api/bar/x402/aws-agent-survival.js": 0.01,
  };
  for (const [rel, want] of Object.entries(standalone)) {
    const got = routePrice(rel);
    if (got === null) {
      fail(rel, "no PRICE_USD constant found");
    } else if (got !== want) {
      fail(rel, `PRICE_USD ${got} != expected ${want} (advertised by aws-agent-survival / discovery)`);
    }
  }

  // The aws-agent-survival map text must advertise the same standalone door prices.
  {
    const where = "aws-agent-survival.js (STANDALONE_DOORS)";
    const raw = readFileSync(join(ROOT, "functions/api/bar/x402/aws-agent-survival.js"), "utf8");
    const expect = [
      ["peril-router", 0.01],
      ["transcribe-extract", 0.05],
      ["doc-extract", 0.05],
      ["bazaar-index-check", 0.05],
      ["x402-doctor", 0.25],
    ];
    for (const [slug, price] of expect) {
      const re = new RegExp(`slug:\\s*"${slug.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}"[\\s\\S]*?price_usd:\\s*([\\d.]+)`);
      const m = raw.match(re);
      if (!m) {
        fail(where, `door ${slug} not found`);
      } else if (Number(m[1]) !== price) {
        fail(where, `door ${slug} price_usd ${m[1]} != ${price}`);
      }
    }
  }
}

if (failures.length) {
  console.error("Discovery consistency check FAILED:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n${failures.length} issue(s). Canonical version: ${CANONICAL_VERSION}`);
  process.exit(1);
}

console.log(`Discovery consistency OK — canonical @secondeyes/mcp-unblock@${CANONICAL_VERSION}, x402 v${X402_VERSION}, ${NETWORK}.`);
