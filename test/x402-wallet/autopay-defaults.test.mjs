#!/usr/bin/env node
// test/x402-wallet/autopay-defaults.test.mjs
// Unit test for the MCP autopay unblock fixes. No network, no spend, no real
// keys. Asserts the three guarantees that let a wallet-configured MCP agent
// actually autopay the launch menu:
//
//   1. Default allowlist (MCP_X402_ALLOW_SLUGS unset, or "*") = the zero-arg
//      autopay set — the launch-priced catalog MINUS the input-requiring doors
//      (transcribe-extract, doc-extract), which the zero-arg order_service tool
//      cannot convert (Codex C-025). Those two stay priced + routable but are
//      excluded from the default-allow set; an explicit comma list RESTRICTS and
//      can opt one back in. (Supersedes the old Blocker-2 full-catalog default.)
//   2. Price match: every launch slug's catalog price equals the canonical
//      functions/_lib/lounge/constants.js value, and a live-402 quote at the
//      advertised price passes guardPayment (no false price_mismatch). Covers
//      help-me / schema-repair / transcribe-extract / doc-extract. Blocker 4.
//   3. The published package is in the 1.2.x line — never 1.1.x (x402 v1,
//      broken) and never 1.0.x (free reads only). Blocker 8.
//
// Run: node test/x402-wallet/autopay-defaults.test.mjs   (exit 1 on any failure)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  LOUNGE_SERVICE_PRICES_USD,
  SURVIVAL_PRICE_MAX_USD,
  INPUT_REQUIRED_SLUGS,
  ZERO_ARG_AUTOPAY_SLUGS,
  parseAllowSlugs,
  guardPayment,
  priceFrom402,
  walletStatus,
} from "../../packages/secondeye-mcp/src/x402-wallet.js";
import {
  SURVIVAL_MENU,
  SURVIVAL_PRICE_MIN_USD,
  SURVIVAL_PRICE_MAX_USD as CANON_MAX,
} from "../../functions/_lib/lounge/constants.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(
  readFileSync(join(HERE, "../../packages/secondeye-mcp/package.json"), "utf8")
);

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Restore env after each mutation so cases don't leak into each other.
function withAllowEnv(value, fn) {
  const prev = process.env.MCP_X402_ALLOW_SLUGS;
  if (value === undefined) delete process.env.MCP_X402_ALLOW_SLUGS;
  else process.env.MCP_X402_ALLOW_SLUGS = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.MCP_X402_ALLOW_SLUGS;
    else process.env.MCP_X402_ALLOW_SLUGS = prev;
  }
}

console.log("\n[1] Default allowlist = zero-arg catalog, input-requiring doors excluded (C-025)");
const ALL_SLUGS = Object.keys(LOUNGE_SERVICE_PRICES_USD);
const AUTOPAY_DEFAULT_SLUGS = [
  "should-i-pay",
  "claim-check",
  "mcp-wiring",
  "context-compress",
  "loop-detect",
];

withAllowEnv(undefined, () => {
  const allow = parseAllowSlugs();
  check(
    "unset env allows every zero-arg autopay slug",
    ZERO_ARG_AUTOPAY_SLUGS.every((s) => allow.has(s)),
    `missing: ${ZERO_ARG_AUTOPAY_SLUGS.filter((s) => !allow.has(s)).join(",")}`
  );
  check(
    "unset env allows more than just should-i-pay (the old fail-closed default)",
    allow.size > 1 && allow.has("claim-check") && allow.has("mcp-wiring")
  );
  check(
    "input-requiring doors are NOT in the default allow set (C-025)",
    [...INPUT_REQUIRED_SLUGS].every((s) => !allow.has(s)),
    `unexpectedly allowed: ${[...INPUT_REQUIRED_SLUGS].filter((s) => allow.has(s)).join(",")}`
  );
  check(
    "the excluded doors are exactly transcribe-extract + doc-extract",
    INPUT_REQUIRED_SLUGS.has("transcribe-extract") &&
      INPUT_REQUIRED_SLUGS.has("doc-extract") &&
      INPUT_REQUIRED_SLUGS.size === 2
  );
  check(
    "every catalog slug is either zero-arg-allowed or input-required (no slug lost)",
    ALL_SLUGS.every((s) => ZERO_ARG_AUTOPAY_SLUGS.includes(s) || INPUT_REQUIRED_SLUGS.has(s))
  );
  for (const slug of AUTOPAY_DEFAULT_SLUGS) {
    const g = guardPayment(slug, LOUNGE_SERVICE_PRICES_USD[slug]);
    check(`autopay default permits "${slug}"`, g.ok === true, JSON.stringify(g));
  }
  // A blind zero-arg autopay of an input-requiring door is blocked by the
  // allow-list (slug_not_allowed), never silently routed to a no_input dead-end.
  for (const slug of INPUT_REQUIRED_SLUGS) {
    const g = guardPayment(slug, LOUNGE_SERVICE_PRICES_USD[slug]);
    check(
      `default blocks input-requiring "${slug}" as slug_not_allowed`,
      g.ok === false && g.code === "slug_not_allowed",
      JSON.stringify(g)
    );
  }
});

withAllowEnv("*", () => {
  const allow = parseAllowSlugs();
  check('"*" allows the full zero-arg set', ZERO_ARG_AUTOPAY_SLUGS.every((s) => allow.has(s)));
  check(
    '"*" still excludes input-requiring doors (same as unset)',
    [...INPUT_REQUIRED_SLUGS].every((s) => !allow.has(s))
  );
});

withAllowEnv("claim-check,mcp-wiring", () => {
  const allow = parseAllowSlugs();
  check("explicit list RESTRICTS to listed slugs", allow.size === 2 && allow.has("claim-check"));
  const blocked = guardPayment("loop-detect", LOUNGE_SERVICE_PRICES_USD["loop-detect"]);
  check(
    "slug outside explicit list is rejected slug_not_allowed",
    blocked.ok === false && blocked.code === "slug_not_allowed"
  );
});

// An operator can explicitly opt an input-requiring door back in; once allowed it
// passes the price guard (its catalog price is a valid quote, no price_mismatch).
withAllowEnv("transcribe-extract", () => {
  const allow = parseAllowSlugs();
  check("explicit opt-in re-enables transcribe-extract", allow.has("transcribe-extract"));
  const g = guardPayment("transcribe-extract", LOUNGE_SERVICE_PRICES_USD["transcribe-extract"]);
  check(
    "opted-in input-requiring slug passes the price guard (no price_mismatch)",
    g.ok === true,
    JSON.stringify(g)
  );
});

console.log("\n[2] Price match — catalog == canonical, no false price_mismatch (Blocker 4)");
// 2a. Survival menu prices mirror the canonical constants.
for (const { slug, price_usd } of SURVIVAL_MENU) {
  check(
    `catalog price for "${slug}" == canonical $${price_usd}`,
    LOUNGE_SERVICE_PRICES_USD[slug] === price_usd,
    `catalog=${LOUNGE_SERVICE_PRICES_USD[slug]}`
  );
}
// 2b. Every catalog price is within the advertised launch band.
for (const [slug, price] of Object.entries(LOUNGE_SERVICE_PRICES_USD)) {
  check(
    `"${slug}" price $${price} within launch band $${SURVIVAL_PRICE_MIN_USD}–$${CANON_MAX}`,
    price >= SURVIVAL_PRICE_MIN_USD - 1e-9 && price <= CANON_MAX + 1e-9
  );
}
check("SURVIVAL_PRICE_MAX_USD ceiling == canonical max", SURVIVAL_PRICE_MAX_USD === CANON_MAX);

// 2c. The four task-named nano slugs are present at their canonical prices, and
// a live-402 quote at the advertised price passes guardPayment (no false reject).
// transcribe-extract/doc-extract are off the default allow set (C-025), so opt
// them in explicitly here — this section probes the PRICE guard, not the allow
// list, and we don't want slug_not_allowed to mask a price regression.
const NANO_EXPECTED = {
  "help-me": 0.01,
  "schema-repair": 0.03,
  "transcribe-extract": 0.05,
  "doc-extract": 0.05,
};
withAllowEnv(Object.keys(NANO_EXPECTED).join(","), () => {
  for (const [slug, price] of Object.entries(NANO_EXPECTED)) {
    check(`nano "${slug}" catalog == $${price}`, LOUNGE_SERVICE_PRICES_USD[slug] === price);

    // Simulate an x402 v2 402 body quoting the advertised price in USDC micros.
    const body = { accepts: [{ amount: String(Math.round(price * 1_000_000)) }] };
    const quoted = priceFrom402(body, slug);
    check(`priceFrom402 reads "${slug}" 402 quote as $${price}`, Math.abs(quoted - price) < 1e-9, `got ${quoted}`);

    const g = guardPayment(slug, quoted);
    check(`guardPayment accepts advertised "${slug}" quote (no price_mismatch)`, g.ok === true, JSON.stringify(g));
  }
});

console.log("\n[3] guardPayment safety retained");
withAllowEnv(undefined, () => {
  const over = guardPayment("mcp-wiring", LOUNGE_SERVICE_PRICES_USD["mcp-wiring"] + 0.01);
  check("over-catalog quote rejected price_mismatch", over.ok === false && over.code === "price_mismatch");
  const unknown = guardPayment("should-i-pay", null);
  check("null price rejected unknown_price", unknown.ok === false && unknown.code === "unknown_price");
  const status = walletStatus();
  check("walletStatus exposes catalog_max_usd ceiling", status.catalog_max_usd === SURVIVAL_PRICE_MAX_USD);
  check("walletStatus caps still present", status.max_call_usd > 0 && status.session_max_usd > 0);
});

console.log("\n[4] Published version is 1.2.x — never 1.1.x or 1.0.x (Blocker 8)");
const v = PKG.version;
const [maj, min] = v.split(".").map(Number);
check(`package.json version "${v}" is 1.2.x`, maj === 1 && min === 2, "must not ship 1.1.x (x402 v1) or 1.0.x (free reads only)");
check("version is not in the broken 1.1.x line", !(maj === 1 && min === 1));
check("version is not in the free-reads-only 1.0.x line", !(maj === 1 && min === 0));

console.log("");
if (failures > 0) {
  console.error(`x402-wallet autopay defaults: ${failures} FAILED`);
  process.exit(1);
}
console.log("x402-wallet autopay defaults: all checks passed");
