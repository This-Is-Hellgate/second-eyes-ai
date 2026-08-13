#!/usr/bin/env node
/** Discovery consistency guard for x402 v2 + the confirmed Data Refinery products. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NETWORK = "eip155:8453";
const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const pkg = json("packages/secondeye-mcp/package.json");
const canonicalVersion = pkg.version;

function noV1(where, raw) {
  if (/ExactEvmSchemeV1/.test(raw)) fail(where, "references ExactEvmSchemeV1");
  if (/x402Version["']?\s*[:=]\s*1\b/.test(raw)) fail(where, "declares x402Version 1");
  if (/"network"\s*:\s*"base"/.test(raw)) fail(where, 'uses network "base" instead of CAIP-2');
}
function paymentBlock(where, block) {
  if (!block) return fail(where, "missing payment block");
  if (block.x402Version !== 2) fail(where, `x402Version ${block.x402Version} != 2`);
  if (block.network !== NETWORK) fail(where, `network ${block.network} != ${NETWORK}`);
}

{
  const server = json("packages/secondeye-mcp/server.json");
  if (server.version !== canonicalVersion) fail("server.json", `version ${server.version} != ${canonicalVersion}`);
  for (const p of server.packages || []) if (p.version !== canonicalVersion) fail("server.json", `package ${p.identifier}@${p.version} != ${canonicalVersion}`);

  const mcpRaw = read("public/.well-known/mcp.json");
  const mcp = JSON.parse(mcpRaw);
  if (mcp.version !== canonicalVersion) fail("mcp.json", `version ${mcp.version} != ${canonicalVersion}`);
  paymentBlock("mcp.json", mcp.payment);
  noV1("mcp.json", mcpRaw);

  const cardRaw = read("public/.well-known/mcp/server-card.json");
  const card = JSON.parse(cardRaw);
  if (card.serverInfo?.version !== canonicalVersion) fail("server-card.json", `version ${card.serverInfo?.version} != ${canonicalVersion}`);
  paymentBlock("server-card.json", card.how_to_pay);
  noV1("server-card.json", cardRaw);

  const agentRaw = read("public/.well-known/agent-card.json");
  paymentBlock("agent-card.json", JSON.parse(agentRaw).how_to_pay);
  noV1("agent-card.json", agentRaw);

  const llms = read("public/llms.txt");
  if (!llms.includes(NETWORK)) fail("llms.txt", `missing ${NETWORK}`);
  if (!llms.includes(`@secondeyes/mcp-unblock@${canonicalVersion}`)) fail("llms.txt", `missing MCP package pin ${canonicalVersion}`);
  noV1("llms.txt", llms);
}

{
  const { SURVIVAL_MENU, SERVICE_PRICES } = await import("../functions/_lib/lounge/constants.js");
  for (const item of SURVIVAL_MENU) {
    const live = SERVICE_PRICES[item.slug]?.price_usd;
    if (typeof live === "number" && live !== item.price_usd) fail("constants.js", `${item.slug} menu price ${item.price_usd} != live ${live}`);
  }
}

const REFINERY = {
  "analyze-video-audio-and-pdfs": {
    path: "/api/bar/x402/analyze-video-audio-and-pdfs",
    file: "functions/api/bar/x402/analyze-video-audio-and-pdfs.js",
    price: 0.05,
    inputs: ["url", "kind"],
    summary: /video|audio|pdf/i,
  },
  "turn-paper-into-code": {
    path: "/api/bar/x402/turn-paper-into-code",
    file: "functions/api/bar/x402/turn-paper-into-code.js",
    price: 0.25,
    inputs: ["paper_url", "target_language", "framework"],
    summary: /paper/i,
  },
};
function routePrice(file) {
  const m = read(file).match(/const PRICE_USD\s*=\s*([\d.]+)/);
  return m ? Number(m[1]) : null;
}

{
  const { buildOpenApi, buildX402Resources } = await import("../functions/_lib/discovery.js");
  const origin = "https://secondeyesai.com";
  const spec = buildOpenApi(origin, {});
  const resources = buildX402Resources(origin, {}, { discoveryVersion: 2 });
  if (spec.openapi !== "3.1.0") fail("discovery.js", `OpenAPI ${spec.openapi} != 3.1.0`);
  if (spec["x-payment"]?.x402Version !== 2) fail("discovery.js", "OpenAPI payment block is not x402 v2");
  if (!(spec["x-payment"]?.active_networks || []).includes(NETWORK)) fail("discovery.js", `active networks missing ${NETWORK}`);
  if ((spec["x-payment"]?.active_networks || []).includes("eip155:137")) fail("discovery.js", "Polygon advertised active instead of planned");
  if (resources.x402Version !== 2) fail("discovery.js", "resource discovery is not x402 v2");
  if (spec.paths["/api/bar/x402/transcribe"]) fail("discovery.js", "advertises legacy transcribe product slug");
  if (spec.paths["/api/bar/x402/extract"]) fail("discovery.js", "advertises legacy extract product slug");
  if ((resources.resources || []).some((r) => /\/(transcribe|extract)$/.test(r.resource || ""))) fail("discovery.js", "resource list advertises legacy one-word product route");

  for (const [slug, expected] of Object.entries(REFINERY)) {
    const livePrice = routePrice(expected.file);
    if (livePrice !== expected.price) fail(expected.file, `PRICE_USD ${livePrice} != ${expected.price}`);
    const path = spec.paths[expected.path];
    if (!path?.get || !path?.post) fail("discovery.js", `missing GET/POST ${expected.path}`);
    if (!expected.summary.test(path?.get?.summary || "")) fail("discovery.js", `${slug} summary does not describe the product`);
    const queryNames = new Set((path?.get?.parameters || []).filter((p) => p.in === "query").map((p) => p.name));
    for (const name of expected.inputs) if (!queryNames.has(name)) fail("discovery.js", `${slug} missing query input ${name}`);
    const r = (resources.resources || []).find((item) => item.slug === slug);
    if (!r) fail("discovery.js", `resource list missing ${slug}`);
    else if (r.price_usd !== expected.price) fail("discovery.js", `${slug} discovery price ${r.price_usd} != ${expected.price}`);
  }
}

{
  const oldTranscribe = read("functions/api/bar/x402/transcribe.js");
  const oldExtract = read("functions/api/bar/x402/extract.js");
  if (!oldTranscribe.includes("/api/bar/x402/analyze-video-audio-and-pdfs")) fail("transcribe.js", "must redirect to Content Analysis");
  if (!oldExtract.includes("/api/bar/x402/turn-paper-into-code")) fail("extract.js", "must redirect to Paper-to-Code");
  if (/handlePaidFetch|runTranscribePipeline/.test(oldTranscribe)) fail("transcribe.js", "legacy alias still contains product implementation");
  if (/handlePaidFetch|runExtractPipeline/.test(oldExtract)) fail("extract.js", "legacy alias still contains product implementation");
}

// Keep this root check dependency-free: nested @x402 packages are installed later in CI.
{
  const wallet = read("packages/secondeye-mcp/src/x402-wallet.js");
  for (const [slug, expected] of Object.entries(REFINERY)) {
    const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const priceMatch = wallet.match(new RegExp(`"${escaped}"\\s*:\\s*([\\d.]+)`));
    if (!priceMatch || Number(priceMatch[1]) !== expected.price) fail("x402-wallet.js", `${slug} catalog price missing or wrong`);
    if (!wallet.includes(`"${slug}",`)) fail("x402-wallet.js", `${slug} missing from input-required set/catalog`);
  }
  if (/"transcribe-extract"\s*:/.test(wallet)) fail("x402-wallet.js", "legacy transcribe-extract catalog slug remains");
  if (/"doc-extract"\s*:/.test(wallet)) fail("x402-wallet.js", "legacy doc-extract catalog slug remains");

  const mcpIndex = read("packages/secondeye-mcp/src/index.js");
  if (!mcpIndex.includes("analyze-video-audio-and-pdfs")) fail("src/index.js", "Content Analysis route missing from MCP copy");
  if (!mcpIndex.includes("turn-paper-into-code")) fail("src/index.js", "Paper-to-Code route missing from MCP copy");
  if (/\/api\/bar\/x402\/transcribe(?:["'`\s])/.test(mcpIndex)) fail("src/index.js", "MCP copy points to legacy transcribe URL");
  if (/\/api\/bar\/x402\/extract(?:["'`\s])/.test(mcpIndex)) fail("src/index.js", "MCP copy points to legacy extract URL");
}

{
  const map = read("functions/api/bar/x402/aws-agent-survival.js");
  for (const slug of Object.keys(REFINERY)) if (!map.includes(`slug: "${slug}"`)) fail("aws-agent-survival.js", `missing ${slug}`);
  if (map.includes('slug: "transcribe-extract"')) fail("aws-agent-survival.js", "legacy transcribe-extract product remains");
  if (map.includes('slug: "doc-extract"')) fail("aws-agent-survival.js", "legacy doc-extract product remains");
}

if (failures.length) {
  console.error("Discovery consistency check FAILED:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n${failures.length} issue(s). Canonical version: ${canonicalVersion}`);
  process.exit(1);
}
console.log(`Discovery consistency OK — x402 v2, ${NETWORK}, package ${canonicalVersion}, refinery routes/prices aligned.`);
