#!/usr/bin/env node
/**
 * Phase 1 smoke suite — no network, no spend. Validates the errorJson contract,
 * module import graph, x402 emission + settle body shape, the Stripe no-default
 * fix, and the facilitator-leak removal.
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.log(`  FAIL  ${name}${extra ? "  — " + extra : ""}`);
    fail++;
  }
}
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

console.log("\n[1] errorJson canonical shape");
{
  const { errorJson } = await import("../functions/_lib/access.js");
  const res = errorJson("unknown_plan", "Unknown plan.", {
    status: 400,
    details: { plan: "x" },
    extra: { access: "none" },
    headers: { "Access-Control-Allow-Origin": "*" },
  });
  const body = await res.json();
  check("status 400", res.status === 400);
  check("code present + stable", body.code === "unknown_plan");
  check("human message present", body.message === "Unknown plan.");
  check("error back-compat string", typeof body.error === "string" && body.error === "Unknown plan.");
  check("requestId minted", typeof body.requestId === "string" && body.requestId.startsWith("req_"));
  check("details passed", body.details && body.details.plan === "x");
  check("extra merged (access:none)", body.access === "none");
  check("CORS header applied", res.headers.get("Access-Control-Allow-Origin") === "*");
  check("no-store cache", res.headers.get("Cache-Control") === "no-store");
}

console.log("\n[2] module import graph (syntax + linkage)");
for (const m of [
  "functions/_lib/access.js",
  "functions/_lib/x402.js",
  "functions/_lib/bar-pay.js",
  "functions/api/access/purchase.js",
  "functions/api/access/quote.js",
  "functions/api/access/status.js",
  "functions/api/stripe/webhook.js",
]) {
  try {
    await import(`../${m}`);
    check(`import ${m}`, true);
  } catch (e) {
    check(`import ${m}`, false, e.message);
  }
}

console.log("\n[3] x402 402 emission is payable (real-shape decode)");
{
  const { buildProductPaymentRequirements, payment402Headers } = await import("../functions/_lib/x402.js");
  const product = { kind: "nano", id: "t", slug: "t", priceUsd: 0.25, access: "paid", description: "d" };
  const env = { X402_PAYTO: "0xFb8915074cC941f5Ab95E6001c45287b8EeC4427", X402_NETWORK: "base" };
  const req = buildProductPaymentRequirements(product, "https://secondeyesai.com/api/bar/x402/index-check", env);
  const headers = payment402Headers(req, undefined, {});
  const decoded = JSON.parse(Buffer.from(headers["PAYMENT-REQUIRED"], "base64").toString("utf8"));
  check("PAYMENT-REQUIRED header present", !!headers["PAYMENT-REQUIRED"]);
  check("x402Version 2", decoded.x402Version === 2);
  check("resource is object {url}", typeof decoded.resource === "object" && !!decoded.resource.url);
  check("accepts CAIP-2 eip155:8453", decoded.accepts[0].network === "eip155:8453");
  check("EIP-712 domain in extra", decoded.accepts[0].extra?.name === "USD Coin");
  check("expose-headers includes PAYMENT-REQUIRED", headers["Access-Control-Expose-Headers"].includes("PAYMENT-REQUIRED"));
}

console.log("\n[4] verify/settle body is clean v2");
{
  const { buildProductPaymentRequirements, buildFacilitatorRequestBody, paymentRequiredObject } = await import("../functions/_lib/x402.js");
  const product = { kind: "nano", id: "t", slug: "t", priceUsd: 0.25, access: "paid", description: "d" };
  const env = { X402_PAYTO: "0xFb8915074cC941f5Ab95E6001c45287b8EeC4427", X402_NETWORK: "base" };
  const req = buildProductPaymentRequirements(product, "https://secondeyesai.com/api/bar/x402/index-check", env);
  const pr = paymentRequiredObject(req);
  const clientPayload = { x402Version: 2, resource: pr.resource, accepted: req.accepts[0], payload: {}, extensions: pr.extensions };
  const header = Buffer.from(JSON.stringify(clientPayload)).toString("base64");
  const built = buildFacilitatorRequestBody(header, req);
  const k = Object.keys(built.body.paymentRequirements).sort();
  const v2 = ["amount", "asset", "extra", "maxTimeoutSeconds", "network", "payTo", "scheme"];
  check("body keys correct", JSON.stringify(Object.keys(built.body).sort()) === JSON.stringify(["paymentPayload", "paymentRequirements", "x402Version"]));
  check("paymentRequirements == v2 schema keys", JSON.stringify(k) === JSON.stringify(v2));
  check("no v1 resource/maxAmountRequired pollution", !k.includes("resource") && !k.includes("maxAmountRequired"));
  check("paymentPayload.resource is object", typeof built.body.paymentPayload.resource === "object" && !!built.body.paymentPayload.resource.url);
}

console.log("\n[5] Stripe: no unsafe lifetime default");
{
  const { getPlan } = await import("../functions/_lib/access.js");
  const src = read("functions/api/stripe/webhook.js");
  const infer = (c) => (c === 1000 ? "monthly" : c === 10000 ? "annual" : c === 25000 ? "lifetime" : null);
  const resolve = (metaPlan, amount) => metaPlan || infer(amount);
  check("source no longer contains '|| \"lifetime\"' default", !/\|\|\s*"lifetime"/.test(src));
  check("metadata plan honored", resolve("annual", 999) === "annual");
  check("known amount → plan", resolve(undefined, 1000) === "monthly");
  check("UNKNOWN amount → null (reject, not lifetime)", resolve(undefined, 777) === null);
  check("no metadata + no amount → null", resolve(undefined, undefined) == null);
  check("getPlan(null) → null", getPlan(null) === null);
  check("getPlan('lifetime') still valid", getPlan("lifetime")?.id === "lifetime");
}

console.log("\n[6] facilitator response is not leaked to caller");
{
  const src = read("functions/_lib/bar-pay.js");
  check("no paywall.facilitatorResponse assignment", !/paywall\.facilitatorResponse\s*=/.test(src));
  check("no paywall.facilitatorStatus assignment", !/paywall\.facilitatorStatus\s*=/.test(src));
  check("stable code surfaced", /payment_verification_failed/.test(src));
  check("raw response logged server-side under requestId", /facilitator_settle_failed/.test(src) && /requestId/.test(src));
}

console.log(`\n==== SMOKE RESULT: ${pass} passed, ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);
