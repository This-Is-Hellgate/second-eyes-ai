#!/usr/bin/env node
/**
 * No-spend proof of the help-me POST contract (functions/api/bar/x402/help-me.js):
 *
 *   - Every help-me body field is optional, so an EMPTY POST is a valid "just
 *     route me" distress call and MUST reach the x402 paywall → 402, not bounce
 *     as 400 invalid_json.
 *   - A NON-empty body that fails to parse is genuinely malformed → 400.
 *   - A well-formed JSON body with no payment header → 402.
 *
 * Pure: no network, no D1 (env without DB), no real keys. The unpaid path in
 * handlePaidFetch returns the 402 before any settlement. Exit 1 on any failure.
 */

import { onRequestPost } from "../functions/api/bar/x402/help-me.js";

const failures = [];
const eq = (where, got, want) => {
  if (got !== want) failures.push(`${where}: got ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
};

// X402_PAYTO present so buildProductPaymentRequirements yields a real 402; no DB
// so no counter write. No facilitator needed — unpaid path never settles.
const env = { X402_PAYTO: "0xFb8915074cC941f5Ab95E6001c45287b8EeC4427", X402_NETWORK: "base" };

const ctx = (request) => ({ request, env });
const post = (body) =>
  new Request("https://secondeyesai.com/api/bar/x402/help-me", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body }),
  });

// 1. Empty POST (no body) → reaches paywall → 402.
{
  const res = await onRequestPost(ctx(post(undefined)));
  eq("empty-post status", res.status, 402);
}

// 2. Explicit empty-string body → treated as {} → 402.
{
  const res = await onRequestPost(ctx(post("")));
  eq("empty-string-body status", res.status, 402);
}

// 3. Whitespace-only body → treated as {} → 402.
{
  const res = await onRequestPost(ctx(post("   \n  ")));
  eq("whitespace-body status", res.status, 402);
}

// 4. Well-formed JSON, no payment header → 402.
{
  const res = await onRequestPost(ctx(post(JSON.stringify({ state: "I am looping", attempts: 3 }))));
  eq("valid-json status", res.status, 402);
}

// 5. Malformed NON-empty body → 400 invalid_json (must NOT be treated as {}).
{
  const res = await onRequestPost(ctx(post("{not json")));
  eq("malformed-body status", res.status, 400);
  const json = await res.json();
  eq("malformed-body error", json.error, "invalid_json");
}

if (failures.length) {
  console.error("help-me POST self-test FAILED:\n");
  for (const f of failures) console.error(`  x ${f}`);
  console.error(`\n${failures.length} failure(s).`);
  process.exit(1);
}

console.log(
  "help-me POST self-test OK — empty/blank POST reaches the x402 paywall (402); malformed non-empty body still 400."
);
