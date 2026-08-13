#!/usr/bin/env node
// Unit test for MCP x402 catalog/autopay defaults. No network, no spend, no real keys.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CAPABILITY_PRICES_USD,
  CAPABILITY_PRICE_MAX_USD,
  INPUT_REQUIRED_SLUGS,
  ZERO_ARG_AUTOPAY_SLUGS,
  parseAllowSlugs,
  guardPayment,
  priceFrom402,
  walletStatus,
} from "../../packages/secondeye-mcp/src/x402-wallet.js";
import { SURVIVAL_MENU } from "../../functions/_lib/lounge/constants.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(HERE, "../../packages/secondeye-mcp/package.json"), "utf8"));

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
function withAllowEnv(value, fn) {
  const prev = process.env.MCP_X402_ALLOW_SLUGS;
  if (value === undefined) delete process.env.MCP_X402_ALLOW_SLUGS;
  else process.env.MCP_X402_ALLOW_SLUGS = value;
  try { fn(); } finally {
    if (prev === undefined) delete process.env.MCP_X402_ALLOW_SLUGS;
    else process.env.MCP_X402_ALLOW_SLUGS = prev;
  }
}

console.log("\n[1] Default autopay excludes input-requiring refinery products");
const ALL_SLUGS = Object.keys(CAPABILITY_PRICES_USD);
withAllowEnv(undefined, () => {
  const allow = parseAllowSlugs();
  check("unset env allows every zero-arg slug", ZERO_ARG_AUTOPAY_SLUGS.every((s) => allow.has(s)));
  check("input-required refinery products are excluded", [...INPUT_REQUIRED_SLUGS].every((s) => !allow.has(s)));
  check(
    "exact input-required set is the two confirmed refinery offerings",
    INPUT_REQUIRED_SLUGS.size === 2 &&
      INPUT_REQUIRED_SLUGS.has("analyze-video-audio-and-pdfs") &&
      INPUT_REQUIRED_SLUGS.has("turn-paper-into-code")
  );
  check("every catalog slug remains classified", ALL_SLUGS.every((s) => ZERO_ARG_AUTOPAY_SLUGS.includes(s) || INPUT_REQUIRED_SLUGS.has(s)));
  for (const slug of INPUT_REQUIRED_SLUGS) {
    const g = guardPayment(slug, CAPABILITY_PRICES_USD[slug]);
    check(`default blocks input-required ${slug}`, g.ok === false && g.code === "slug_not_allowed", JSON.stringify(g));
  }
});

withAllowEnv("*", () => {
  const allow = parseAllowSlugs();
  check('"*" still means safe zero-arg set', ZERO_ARG_AUTOPAY_SLUGS.every((s) => allow.has(s)));
  check('"*" still excludes input-required refinery calls', [...INPUT_REQUIRED_SLUGS].every((s) => !allow.has(s)));
});

console.log("\n[2] Confirmed refinery pricing and payment guards");
const REFINERY_EXPECTED = {
  "analyze-video-audio-and-pdfs": 0.05,
  "turn-paper-into-code": 0.25,
};
withAllowEnv(Object.keys(REFINERY_EXPECTED).join(","), () => {
  for (const [slug, price] of Object.entries(REFINERY_EXPECTED)) {
    check(`${slug} catalog price is $${price}`, CAPABILITY_PRICES_USD[slug] === price);
    const body = { accepts: [{ amount: String(Math.round(price * 1_000_000)) }] };
    const quoted = priceFrom402(body, slug);
    check(`priceFrom402 reads ${slug}`, Math.abs(quoted - price) < 1e-9, `got ${quoted}`);
    const g = guardPayment(slug, quoted);
    check(`guardPayment accepts advertised ${slug} quote`, g.ok === true, JSON.stringify(g));
  }
});
check("catalog maximum now includes Paper-to-Code", CAPABILITY_PRICE_MAX_USD === 0.25);
check("legacy transcribe-extract removed", !("transcribe-extract" in CAPABILITY_PRICES_USD));
check("legacy doc-extract removed", !("doc-extract" in CAPABILITY_PRICES_USD));

console.log("\n[3] Existing recovery prices still mirror their canonical menu");
for (const { slug, price_usd } of SURVIVAL_MENU) {
  check(`catalog price for ${slug} == canonical $${price_usd}`, CAPABILITY_PRICES_USD[slug] === price_usd, `catalog=${CAPABILITY_PRICES_USD[slug]}`);
}

console.log("\n[4] Safety retained");
withAllowEnv(undefined, () => {
  const over = guardPayment("mcp-wiring", CAPABILITY_PRICES_USD["mcp-wiring"] + 0.01);
  check("over-catalog quote rejected", over.ok === false && over.code === "price_mismatch");
  const unknown = guardPayment("should-i-pay", null);
  check("null price rejected", unknown.ok === false && unknown.code === "unknown_price");
  const status = walletStatus();
  check("walletStatus exposes catalog ceiling", status.catalog_max_usd === CAPABILITY_PRICE_MAX_USD);
  check("wallet caps remain present", status.max_call_usd > 0 && status.session_max_usd > 0);
});

console.log("\n[5] Published package stays on x402-v2-capable 1.2.x line");
const [maj, min] = PKG.version.split(".").map(Number);
check(`package ${PKG.version} is 1.2.x`, maj === 1 && min === 2);

if (failures > 0) {
  console.error(`x402-wallet autopay defaults: ${failures} FAILED`);
  process.exit(1);
}
console.log("x402-wallet autopay defaults: all checks passed");
