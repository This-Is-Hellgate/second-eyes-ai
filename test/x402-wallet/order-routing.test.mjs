#!/usr/bin/env node
// test/x402-wallet/order-routing.test.mjs
// Unit test for the MCP order_service / github_mcp_401_fix autopay ROUTING fixes
// (Codex C-019, C-020). No network, no spend, no keys.
//
//   C-019: order_service must hit the SESSION-LESS /api/bar/x402/{path} twin, not
//          the session-gated /api/bar/services/{slug}. A wallet agent holds no
//          real lounge session, so the gated route returns 4xx (never 402) and
//          payAndRetryService never fires — the agent dead-ends on
//          unknown_service / missing_session instead of autopaying. Every autopay
//          catalog slug must resolve to a live session-less x402 path, including
//          the two task-named nano slugs whose static route file is named
//          differently (transcribe-extract → transcribe, doc-extract → extract).
//   C-020: github_mcp_401_fix orders mcp-wiring; it must resolve to the same
//          session-less twin so its advertised autopay can actually complete.
//
// Run: node test/x402-wallet/order-routing.test.mjs   (exit 1 on any failure)

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CAPABILITY_PRICES_USD,
  x402RouteSlug,
  x402ServicePath,
} from "../../packages/secondeye-mcp/src/x402-wallet.js";
import { X402_TWIN_SLUGS } from "../../functions/_lib/lounge/constants.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const X402_DIR = join(ROOT, "functions/api/bar/x402");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// A session-less x402 route is live if EITHER a static route file with that name
// exists (e.g. help-me.js, transcribe.js) OR the slug is in X402_TWIN_SLUGS and
// is served by the dynamic [slug].js route.
const staticRouteFiles = new Set(
  readdirSync(X402_DIR)
    .filter((f) => f.endsWith(".js") && f !== "[slug].js")
    .map((f) => f.replace(/\.js$/, ""))
);
function routeIsLive(routeSlug) {
  return staticRouteFiles.has(routeSlug) || X402_TWIN_SLUGS.has(routeSlug);
}

console.log("\n[1] Every autopay catalog slug resolves to a LIVE session-less x402 route (C-019)");
for (const slug of Object.keys(CAPABILITY_PRICES_USD)) {
  const path = x402ServicePath(slug);
  check(`"${slug}" resolves to an /api/bar/x402 path`, typeof path === "string" && path.startsWith("/api/bar/x402/"), JSON.stringify(path));
  const routeSlug = x402RouteSlug(slug);
  check(`"${slug}" → "${routeSlug}" is a live x402 route`, routeIsLive(routeSlug), `not static-file and not in X402_TWIN_SLUGS`);
}

console.log("\n[2] order_service must NOT target the session-gated /api/bar/services route (C-019)");
const indexSrc = readFileSync(join(ROOT, "packages/secondeye-mcp/src/index.js"), "utf8");
const orderBlock = indexSrc.slice(indexSrc.indexOf('"order_service"'), indexSrc.indexOf('"leave_with_receipt"'));
check(
  "order_service handler uses x402ServicePath (session-less)",
  /x402ServicePath\(slug\)/.test(orderBlock),
  "order_service should resolve the session-less twin"
);
check(
  "order_service handler does NOT hard-code /api/bar/services/${slug}",
  !/\/api\/bar\/services\/\$\{slug\}/.test(orderBlock),
  "still routing to the session-gated path"
);

console.log("\n[3] The differently-named static nano routes map correctly (C-019)");
check('"transcribe-extract" → /api/bar/x402/transcribe', x402ServicePath("transcribe-extract") === "/api/bar/x402/transcribe");
check('"doc-extract" → /api/bar/x402/extract', x402ServicePath("doc-extract") === "/api/bar/x402/extract");
check("unknown slug resolves to null (rejected, not mis-routed)", x402ServicePath("not-a-real-slug") === null);

console.log("\n[4] github_mcp_401_fix routes mcp-wiring through autopay, not a bare service call (C-020)");
const fixBlock = indexSrc.slice(indexSrc.indexOf('"github_mcp_401_fix"'));
check("github_mcp_401_fix calls payAndRetryService for the mcp-wiring order", /payAndRetryService\(/.test(fixBlock));
check("github_mcp_401_fix resolves the session-less twin via x402ServicePath", /x402ServicePath\(/.test(fixBlock));
check(
  "github_mcp_401_fix no longer hard-calls /api/bar/services/mcp-wiring",
  !/\/api\/bar\/services\/mcp-wiring/.test(fixBlock),
  "still hitting the session-gated route — autopay cannot complete"
);
check("github_mcp_401_fix can return paid_via_mcp_x402 on success", /paid_via_mcp_x402/.test(fixBlock));

console.log("");
if (failures > 0) {
  console.error(`x402-wallet order routing: ${failures} FAILED`);
  process.exit(1);
}
console.log("x402-wallet order routing: all checks passed");
