#!/usr/bin/env node
// test/x402-facilitator/mocked.test.mjs
// LAYER 1 — Mocked CDP facilitator integration. Always safe to run: no network,
// no spend, no real keys, no env vars required.
//
// Proves the safety invariants that MUST hold before any real facilitator is
// touched, asserted against the production code in functions/_lib/x402.js +
// x402-networks.js (the PR #17 multi-network builder + accept selector):
//
//   1. accepts[] shape per env: Base default, Polygon opt-in, Solana double-gated
//   2. CDP /verify receives ONLY the matching paymentRequirements, never accepts[]
//   3. CDP /settle reuses the SAME body /verify accepted (no rail swap)
//   4. The selected accepts[] entry (buyer's rail) is what reaches verify/settle
//   5. Network mismatch is rejected WITHOUT calling the facilitator
//   6. Malformed / missing payment header rejected WITHOUT calling the facilitator
//   7. /settle is never called when /verify rejects
//   8. Atomic-unit (USDC micros) invariant on every accepts[] entry
//   9. No production payTo / key reuse (isolation gate fires on collision)
//
// Run: node test/x402-facilitator/mocked.test.mjs   (exit 1 on any failure)

import {
  buildProductPaymentRequirements,
  buildFacilitatorRequestBody,
  paymentRequiredObject,
  payment402BodyForProduct,
  encodePaymentRequiredHeader,
  parsePaymentPayloadFromHeader,
  verifyPaymentHeader,
  settleBuiltPayment,
  usdToUsdcMicros,
} from "../../functions/_lib/x402.js";
import { facilitatorPaths } from "../../functions/_lib/cdp-auth.js";
import { installMockFacilitator, makeSyntheticPaymentHeader } from "./mock-facilitator.mjs";
import { usdToAtomic, assertTestPayToIsolation, supportedUrlFor } from "./env.mjs";

const BASE = "eip155:8453";
const POLY = "eip155:137";
const SOL = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// Polygon no longer enters accepts[] on X402_POLYGON_ENABLED alone (the failed-canary
// fix): it also needs a VALID activation record. Supply one (env form) wherever a
// case asserts Polygon active. Activation-gate edge cases are covered in
// scripts/x402-rail-activation-selftest.mjs.
const POLY_RECORD = JSON.stringify({
  activated: true,
  amoy_layer3_passes: 3,
  mainnet_smoke_tx: "0xsmoke",
});

// Distinct production-looking wallets used purely as fixtures.
const PROD_EVM = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const PROD_SOL = "DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy";
const RESOURCE = "https://secondeyesai.com/api/bar/x402/help-me";

// The facilitator URL routes to the mock (host api.cdp.coinbase.com is intercepted).
// CDP creds are intentionally absent so buildCdpAuthHeaders sends an unauthed
// request to the mock — exactly the spec's MOCK_CDP_ENV strategy.
const FACILITATOR = { X402_FACILITATOR_URL: "https://api.cdp.coinbase.com/platform" };

const product = {
  kind: "nano",
  id: "help-me",
  slug: "help-me",
  priceUsd: 0.01,
  access: "paid",
  description: "help-me — canonical agent-distress door",
};

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
const ok = (where, cond, msg) => {
  if (!cond) fail(where, msg);
};
const eqJson = (where, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(where, `got ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  }
};

function reqsFor(env) {
  return buildProductPaymentRequirements(product, RESOURCE, env);
}
function networksOf(env) {
  return (reqsFor(env)?.accepts || []).map((a) => a.network);
}

// ===========================================================================
// 1. accepts[] shape per env configuration
// ===========================================================================
{
  // Base default — exactly one rail, on eip155:8453, with EIP-712 extra.
  const env = { X402_PAYTO: PROD_EVM };
  eqJson("base-default networks", networksOf(env), [BASE]);
  const a = reqsFor(env).accepts[0];
  ok("base-default", a.payTo === PROD_EVM, `payTo ${a.payTo} != ${PROD_EVM}`);
  ok(
    "base-default",
    a.asset.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    `asset ${a.asset} != Base USDC`
  );
  ok("base-default", a.extra && a.extra.version === "2", "missing EIP-712 extra on EVM rail");
}
{
  // Polygon flag ALONE (no activation record) must NOT advertise — the canary fix.
  eqJson("polygon-flag-alone networks", networksOf({ X402_PAYTO: PROD_EVM, X402_POLYGON_ENABLED: "1" }), [BASE]);
  // Polygon opt-in + valid record — appends eip155:137 as accepts[1], Base stays accepts[0].
  const env = { X402_PAYTO: PROD_EVM, X402_POLYGON_ENABLED: "1", X402_POLYGON_ACTIVATION_RECORD: POLY_RECORD };
  eqJson("polygon-optin networks", networksOf(env), [BASE, POLY]);
}
{
  // Solana configured but NOT active — must NOT advertise (an unsettleable rail
  // an agent could choose but the server can't settle = the agent loses money).
  const env = { X402_PAYTO: PROD_EVM, X402_SOLANA_PAY_TO: PROD_SOL };
  eqJson("solana-inactive networks", networksOf(env), [BASE]);
}
{
  // Solana double-gated (payTo AND active flag) — enters accepts[] as an SVM
  // rail (no EIP-712 extra).
  const env = { X402_PAYTO: PROD_EVM, X402_SOLANA_ACTIVE: "1", X402_SOLANA_PAY_TO: PROD_SOL };
  eqJson("solana-gated networks", networksOf(env), [BASE, SOL]);
  const sol = reqsFor(env).accepts.find((x) => x.network === SOL);
  ok("solana-gated", !sol.extra, "Solana accept must NOT carry EIP-712 extra");
  ok("solana-gated", sol.payTo === PROD_SOL, "Solana payTo not applied");
}
{
  // Base is invariably accepts[0] across every configuration.
  for (const env of [
    { X402_PAYTO: PROD_EVM },
    { X402_PAYTO: PROD_EVM, X402_POLYGON_ENABLED: "1", X402_POLYGON_ACTIVATION_RECORD: POLY_RECORD },
    { X402_PAYTO: PROD_EVM, X402_SOLANA_ACTIVE: "1", X402_SOLANA_PAY_TO: PROD_SOL },
    {
      X402_PAYTO: PROD_EVM,
      X402_POLYGON_ENABLED: "1",
      X402_POLYGON_ACTIVATION_RECORD: POLY_RECORD,
      X402_SOLANA_ACTIVE: "1",
      X402_SOLANA_PAY_TO: PROD_SOL,
    },
  ]) {
    ok("canonical-base", networksOf(env)[0] === BASE, `accepts[0] != Base for ${JSON.stringify(env)}`);
  }
}

// ===========================================================================
// 8. Atomic-unit (USDC micros) invariant — every accepts[] amount is an integer
//    micros string. Cross-checked against an independent usdToAtomic().
// ===========================================================================
{
  ok("atomic", usdToUsdcMicros(0.001) === "1000", `usdToUsdcMicros(0.001)=${usdToUsdcMicros(0.001)} != 1000`);
  ok("atomic", usdToAtomic(0.001) === "1000", "independent usdToAtomic(0.001) != 1000");
  ok("atomic", usdToUsdcMicros(0.01) === usdToAtomic(0.01), "builder vs harness micros disagree");

  const env = { X402_PAYTO: PROD_EVM, X402_SOLANA_ACTIVE: "1", X402_SOLANA_PAY_TO: PROD_SOL };
  for (const a of reqsFor(env).accepts) {
    ok("atomic", /^\d+$/.test(a.amount), `amount "${a.amount}" is not an integer string`);
    ok("atomic", !a.amount.includes("."), `amount "${a.amount}" contains a decimal`);
    ok("atomic", !/[eE]/.test(a.amount), `amount "${a.amount}" is in exponent form`);
  }
}

// ===========================================================================
// 2-4. Facilitator sees ONLY the buyer's matching requirement; settle reuses it.
//     Asserted end-to-end through the real verifyPaymentHeader/settleBuiltPayment.
// ===========================================================================
async function verifyThenSettle(env, network, opts) {
  const mock = installMockFacilitator(opts);
  try {
    const requirement = reqsFor(env);
    const header = makeSyntheticPaymentHeader(network, opts?.headerOpts);
    const verified = await verifyPaymentHeader(header, requirement, { ...env, ...FACILITATOR });
    let settled = null;
    if (verified.ok) {
      settled = await settleBuiltPayment(verified.built, verified.accept, { ...env, ...FACILITATOR });
    }
    return { mock, verified, settled };
  } finally {
    mock.restore();
  }
}

await (async () => {
  // Multi-rail env: Base + Polygon (proven) + Solana all advertised.
  const env = {
    X402_PAYTO: PROD_EVM,
    X402_POLYGON_ENABLED: "1",
    X402_POLYGON_ACTIVATION_RECORD: POLY_RECORD,
    X402_SOLANA_ACTIVE: "1",
    X402_SOLANA_PAY_TO: PROD_SOL,
  };

  // --- Base buyer → verify gets ONLY the Base requirement ---
  {
    const { mock, verified } = await verifyThenSettle(env, BASE);
    ok("verify-base", verified.ok, `verify failed: ${verified.error}`);
    ok("verify-base", mock.verifyCalls().length === 1, `expected 1 verify call, got ${mock.verifyCalls().length}`);
    const sent = mock.verifyCalls()[0].body?.paymentRequirements;
    ok("verify-base", sent && sent.network === BASE, `verify saw network ${sent?.network} != Base`);
    ok("verify-base", !Array.isArray(sent), "verify body carried an array, not a single requirement");
    ok("verify-base", sent.network !== SOL && sent.network !== POLY, "verify leaked a non-chosen rail");
  }

  // --- Polygon buyer → verify gets ONLY the Polygon requirement ---
  {
    const { mock, verified } = await verifyThenSettle(env, POLY);
    ok("verify-poly", verified.ok, `verify failed: ${verified.error}`);
    const sent = mock.verifyCalls()[0].body?.paymentRequirements;
    ok("verify-poly", sent.network === POLY, `verify saw ${sent.network} != Polygon`);
  }

  // --- Solana buyer → /settle reuses EXACTLY the body /verify accepted ---
  {
    const { mock, verified, settled } = await verifyThenSettle(env, SOL);
    ok("settle-reuse", verified.ok, `verify failed: ${verified.error}`);
    ok("settle-reuse", settled && settled.ok, `settle failed: ${settled?.error}`);
    ok("settle-reuse", mock.settleCalls().length === 1, "expected exactly 1 settle call");
    const verifyReq = mock.verifyCalls()[0].body?.paymentRequirements;
    const settleReq = mock.settleCalls()[0].body?.paymentRequirements;
    eqJson("settle-reuse req identical", settleReq, verifyReq);
    ok("settle-reuse", settleReq.network === SOL, `settle saw ${settleReq.network} != Solana`);
    // The whole built body must be byte-identical between verify and settle.
    eqJson("settle-reuse body identical", mock.settleCalls()[0].body, mock.verifyCalls()[0].body);
  }

  // --- Selected accept matches buyer's rail at the builder level too ---
  {
    const requirement = reqsFor(env);
    for (const [payload, want, label] of [
      [{ x402Version: 2, accepted: { network: POLY } }, POLY, "accepted.network=Polygon"],
      [{ x402Version: 2, network: SOL }, SOL, "top-level network=Solana"],
      [{ x402Version: 2 }, BASE, "legacy no-network → Base accepts[0]"],
    ]) {
      const built = buildFacilitatorRequestBody(
        Buffer.from(JSON.stringify(payload)).toString("base64"),
        requirement
      );
      ok("select", built.ok, `${label}: build failed (${built.error})`);
      ok("select", built.accept.network === want, `${label}: selected ${built.accept?.network} != ${want}`);
    }
  }
})();

// ===========================================================================
// 10. Header stays lean (truncated resource.description) but verify/settle get
//     the FULL description. Codex review of PR #23: a normal v2 client copies the
//     resource OBJECT verbatim out of PAYMENT-REQUIRED (which carries the 220-char
//     truncated text) into its payment payload. buildFacilitatorRequestBody must
//     re-derive the rich description from `requirement` for the object case too,
//     not pass the truncated copy straight through to CDP /verify and /settle.
// ===========================================================================
{
  const HEADER_MAX = 220;
  // A description well over the header cap so truncation is observable end-to-end.
  const longProduct = {
    kind: "nano",
    id: "help-me",
    slug: "help-me",
    priceUsd: 0.01,
    access: "paid",
    description:
      "help-me — canonical agent-distress door. " +
      "Full MCP context library for stranded autonomous agents: survival runbooks, " +
      "escalation contacts, structured recovery playbooks, and the complete catalog of " +
      "Second Eyes services an agent can call to get unstuck, all delivered as a single " +
      "paid bar-tab session that a buyer's facilitator must catalog with the rich text intact.",
  };
  ok(
    "header-vs-facilitator",
    longProduct.description.length > HEADER_MAX,
    "fixture description must exceed the header cap to make truncation observable"
  );

  const env = { X402_PAYTO: PROD_EVM };
  const requirement = buildProductPaymentRequirements(longProduct, RESOURCE, env);

  // --- PAYMENT-REQUIRED header carries the LEAN (truncated) description ---
  const headerObj = paymentRequiredObject(requirement);
  const headerDesc = headerObj.resource.description;
  ok(
    "header-vs-facilitator",
    headerDesc.length <= HEADER_MAX,
    `header resource.description length ${headerDesc.length} > cap ${HEADER_MAX}`
  );
  ok(
    "header-vs-facilitator",
    headerDesc !== longProduct.description,
    "header resource.description should be truncated, not the full text"
  );
  ok(
    "header-vs-facilitator",
    headerDesc.endsWith("…"),
    "truncated header description should end with an ellipsis"
  );
  ok(
    "header-vs-facilitator",
    headerObj.resource.url === RESOURCE,
    `header resource.url ${headerObj.resource.url} != ${RESOURCE}`
  );
  ok(
    "header-vs-facilitator",
    headerObj.resource.mimeType === "application/json",
    "header resource.mimeType not preserved"
  );

  // A spec-compliant v2 client copies the resource OBJECT verbatim from the header
  // into its payment payload. Decode the header object exactly as the client would.
  const headerResource = parsePaymentPayloadFromHeader(
    encodePaymentRequiredHeader(headerObj)
  ).resource;

  // Three buyer shapes: object-from-header (the common case Codex flagged),
  // string-only, and resource omitted entirely.
  const cases = [
    ["object-from-header", headerResource],
    ["string-only", RESOURCE],
    ["resource-omitted", undefined],
  ];
  for (const [label, resource] of cases) {
    const payload = {
      x402Version: 2,
      scheme: "exact",
      network: BASE,
      accepted: { network: BASE },
      ...(resource === undefined ? {} : { resource }),
      payload: { signature: "0x" + "00".repeat(65) },
    };
    const built = buildFacilitatorRequestBody(
      Buffer.from(JSON.stringify(payload)).toString("base64"),
      requirement
    );
    ok("header-vs-facilitator", built.ok, `${label}: build failed (${built.error})`);
    const sentResource = built.body?.paymentPayload?.resource;
    ok("header-vs-facilitator", sentResource && typeof sentResource === "object", `${label}: resource not an object`);
    eqJson(`facilitator full description (${label})`, sentResource.description, longProduct.description);
    ok(
      "header-vs-facilitator",
      sentResource.description.length > HEADER_MAX,
      `${label}: facilitator got truncated description (len ${sentResource.description.length})`
    );
    ok(
      "header-vs-facilitator",
      sentResource.url === RESOURCE,
      `${label}: resource.url ${sentResource.url} != ${RESOURCE}`
    );
    ok(
      "header-vs-facilitator",
      sentResource.mimeType === "application/json",
      `${label}: resource.mimeType not preserved`
    );
    // Bazaar metadata (full extensions) still echoed server-side to CDP.
    ok(
      "header-vs-facilitator",
      built.body.paymentPayload.extensions &&
        JSON.stringify(built.body.paymentPayload.extensions) ===
          JSON.stringify(requirement.extensions),
      `${label}: facilitator payload missing full extensions echo`
    );
  }

  // --- The buyer's SIGNED resource URL is preserved (not clobbered by requirement) ---
  {
    const buyerUrl = "https://secondeyesai.com/api/bar/x402/help-me?ref=agent42";
    const payload = {
      x402Version: 2,
      scheme: "exact",
      network: BASE,
      accepted: { network: BASE },
      resource: { url: buyerUrl, description: "stale truncated…", mimeType: "application/json" },
      payload: { signature: "0x" + "00".repeat(65) },
    };
    const built = buildFacilitatorRequestBody(
      Buffer.from(JSON.stringify(payload)).toString("base64"),
      requirement
    );
    ok("header-vs-facilitator", built.ok, `signed-url: build failed (${built.error})`);
    ok(
      "header-vs-facilitator",
      built.body.paymentPayload.resource.url === buyerUrl,
      "buyer's signed resource.url must be preserved"
    );
    eqJson(
      "facilitator full description (signed-url)",
      built.body.paymentPayload.resource.description,
      longProduct.description
    );
  }

  // --- The 402 JSON body still carries the full description + Bazaar extensions ---
  {
    const body = payment402BodyForProduct(requirement, longProduct, null, "https://secondeyesai.com");
    eqJson("402-body full description", body.description, longProduct.description);
    ok("header-vs-facilitator", body.extensions, "402 body must still carry Bazaar extensions");
  }
}

// ===========================================================================
// 5-7. Rejection paths never call the facilitator.
// ===========================================================================
await (async () => {
  const env = { X402_PAYTO: PROD_EVM }; // Base-only — Solana/Polygon NOT accepted.

  // --- Network mismatch: buyer signs Solana but only Base is accepted ---
  // SAFETY CONTRACT (this PR — hard-reject unknown payload networks): when the
  // buyer's signed network is NOT in accepts[], the selector returns null and the
  // builder hard-rejects with `unsupported_payment_network` BEFORE any facilitator
  // call. The prior behavior silently fell back to accepts[0] (Base) and shipped a
  // Solana/Polygon signature to the Base verify — a 402 with no receipt, exactly
  // the multi-rail incident on Polygon (req_ebefc6f9596f2313). The load-bearing
  // property is now stronger: a mismatched rail never reaches /verify at all.
  {
    const { mock, verified, settled } = await verifyThenSettle(env, SOL, {
      verifyResult: { isValid: false, invalidReason: "network_mismatch" },
    });
    ok("mismatch", !verified.ok, "mismatched rail must be rejected");
    ok(
      "mismatch",
      verified.error === "unsupported_payment_network",
      `error ${verified.error} != unsupported_payment_network`
    );
    ok("mismatch", verified.declaredNetwork === SOL, "rejection should name the declared rail");
    ok("mismatch", mock.verifyCalls().length === 0, "mismatch must never reach /verify");
    ok("mismatch", mock.settleCalls().length === 0, "mismatch must never reach /settle");
    ok("mismatch", !settled, "settle must NOT run after a rejected mismatch");
  }

  // --- Malformed header: not base64 JSON at all ---
  {
    const mock = installMockFacilitator();
    try {
      const requirement = reqsFor(env);
      const verified = await verifyPaymentHeader(
        "this-is-not-base64-json-at-all-!!!",
        requirement,
        { ...env, ...FACILITATOR }
      );
      ok("malformed", !verified.ok, "expected malformed header to be rejected");
      ok("malformed", verified.error === "invalid_payment_header", `error ${verified.error} != invalid_payment_header`);
      ok("malformed", mock.calls.length === 0, `malformed header must not touch facilitator (${mock.calls.length} calls)`);
    } finally {
      mock.restore();
    }
  }

  // --- Empty header: missing PAYMENT-SIGNATURE ---
  {
    const mock = installMockFacilitator();
    try {
      const requirement = reqsFor(env);
      const verified = await verifyPaymentHeader("", requirement, { ...env, ...FACILITATOR });
      ok("empty-header", !verified.ok, "expected empty header to be rejected");
      ok("empty-header", mock.calls.length === 0, `empty header must not touch facilitator (${mock.calls.length} calls)`);
    } finally {
      mock.restore();
    }
  }

  // --- Facilitator rejects verify → settle is NOT called ---
  {
    const { mock, verified, settled } = await verifyThenSettle(
      env,
      BASE,
      { verifyResult: { isValid: false, invalidReason: "insufficient_funds" } }
    );
    ok("verify-reject", !verified.ok, "expected verify to surface facilitator rejection");
    ok("verify-reject", mock.verifyCalls().length === 1, "verify should have been called once");
    ok("verify-reject", !settled, "settle must NOT run after verify rejection");
    ok("verify-reject", mock.settleCalls().length === 0, "settle must NOT be called after verify rejection");
  }
})();

// ===========================================================================
// 9. No production payTo / key reuse — isolation gate fires on collision.
// ===========================================================================
{
  // Collision: test payTo == production payTo → must throw.
  let threw = false;
  try {
    assertTestPayToIsolation({ X402_PAYTO: PROD_EVM, TEST_EVM_PAY_TO: PROD_EVM });
  } catch {
    threw = true;
  }
  ok("isolation", threw, "isolation gate did NOT fire when TEST_EVM_PAY_TO == X402_PAYTO");

  // Distinct addresses → must NOT throw.
  let threwClean = false;
  try {
    assertTestPayToIsolation({ X402_PAYTO: PROD_EVM, TEST_EVM_PAY_TO: "0xTEST_treasury_distinct" });
  } catch {
    threwClean = true;
  }
  ok("isolation", !threwClean, "isolation gate wrongly fired on distinct test/prod payTo");

  // Solana collision too.
  let threwSol = false;
  try {
    assertTestPayToIsolation({ X402_SOLANA_PAY_TO: PROD_SOL, TEST_SOLANA_PAY_TO: PROD_SOL });
  } catch {
    threwSol = true;
  }
  ok("isolation", threwSol, "isolation gate did NOT fire on Solana payTo collision");
}

// ===========================================================================
// 10. facilitatorPaths() composes to the canonical CDP route for EVERY base
// shape an operator might configure — no duplicated /platform/v2/x402 segment.
// The verify/settle URL is `${paths.base}${paths.verifyPath}` (see x402.js).
// ===========================================================================
{
  const WANT_VERIFY = "https://api.cdp.coinbase.com/platform/v2/x402/verify";
  const WANT_SETTLE = "https://api.cdp.coinbase.com/platform/v2/x402/settle";
  const bases = [
    "https://api.cdp.coinbase.com",
    "https://api.cdp.coinbase.com/",
    "https://api.cdp.coinbase.com/platform",
    "https://api.cdp.coinbase.com/platform/",
    "https://api.cdp.coinbase.com/platform/v2",
    "https://api.cdp.coinbase.com/platform/v2/x402",
    "https://api.cdp.coinbase.com/platform/v2/x402/",
  ];
  for (const input of bases) {
    const p = facilitatorPaths(input);
    eqJson(`facilitator-path verify (${input})`, `${p.base}${p.verifyPath}`, WANT_VERIFY);
    eqJson(`facilitator-path settle (${input})`, `${p.base}${p.settlePath}`, WANT_SETTLE);
    // JWT uri claim needs the full /platform route — verifyPath/settlePath always lead with it.
    ok(
      `facilitator-path jwt-uri (${input})`,
      p.verifyPath.startsWith("/platform/v2/x402/") && p.settlePath.startsWith("/platform/v2/x402/"),
      `paths must keep the full /platform route for the JWT uri claim (got ${p.verifyPath})`
    );
  }
}

// ===========================================================================
// 11. supportedUrlFor() — the Layer 2 dry-run reachability URL builder — resolves
// the GET /supported route for EVERY base shape an operator might bake into a
// TEST_FACILITATOR_URL_* var. This is the no-network guard for Codex C-022: the
// dry-run harness no longer naively appends /supported (which would 404 on a
// `/platform` base); it normalizes CDP bases through facilitatorPaths first and
// leaves non-CDP origins (Polygon Amoy) untouched. Layer 3 (live settlement) goes
// through the production verify/settle path tested in section 10, so a `/platform`
// base is correct on BOTH layers. C-026 extends this to the bare CDP origin
// (no /platform path): a cdp.coinbase.com host is normalized to the canonical
// /platform/v2/x402/supported route too, not the origin's bare /supported.
// ===========================================================================
{
  const WANT_CDP = "https://api.cdp.coinbase.com/platform/v2/x402/supported";
  const cdpBases = [
    "https://api.cdp.coinbase.com",
    "https://api.cdp.coinbase.com/",
    "https://api.cdp.coinbase.com/platform",
    "https://api.cdp.coinbase.com/platform/",
    "https://api.cdp.coinbase.com/platform/v2",
    "https://api.cdp.coinbase.com/platform/v2/x402",
    "https://api.cdp.coinbase.com/platform/v2/x402/",
  ];
  for (const input of cdpBases) {
    eqJson(`supported-url cdp (${input})`, supportedUrlFor(input), WANT_CDP);
  }
  // Non-CDP facilitator (no /platform prefix) exposes /supported off its origin.
  eqJson(
    "supported-url non-cdp (polygon amoy)",
    supportedUrlFor("https://x402-amoy.polygon.technology"),
    "https://x402-amoy.polygon.technology/supported"
  );
  eqJson(
    "supported-url non-cdp (trailing slash)",
    supportedUrlFor("https://x402-amoy.polygon.technology/"),
    "https://x402-amoy.polygon.technology/supported"
  );
}

// ===========================================================================
// Report
// ===========================================================================
if (failures.length) {
  console.error("LAYER 1 (mocked facilitator) FAILED:\n");
  for (const f of failures) console.error(`  x ${f}`);
  console.error(`\n${failures.length} issue(s).`);
  process.exit(1);
}
console.log(
  "LAYER 1 (mocked facilitator) OK — Base default / Polygon opt-in / Solana double-gated; " +
    "verify+settle see only the buyer's matching requirement; malformed/empty headers rejected " +
    "without a facilitator call; mismatched rail never settles; atomic micros enforced; payTo isolation gate live."
);
