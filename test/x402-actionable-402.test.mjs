/**
 * Machine-actionable 402 contract (conversion-path P0).
 *
 * Every unpaid 402 body built by payment402BodyForProduct MUST tell a paying
 * client exactly what to do next and MUST tell a walletless client exactly how
 * to become payment-capable — without exposing any paid result. Root-cause
 * reference: the June–July 2026 conversion outage, where invoices were valid
 * but carried no actionable retry/client instructions.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  payment402BodyForProduct,
  payment402Headers,
  buildProductPaymentRequirements,
  machineActionable402,
  MCP_AUTOPAY_PACKAGE,
  MCP_AUTOPAY_VERSION,
} from "../functions/_lib/x402.js";

const ENV = {
  X402_PAYTO: "0xFb8915074cC941f5Ab95E6001c45287b8EeC4427",
  X402_FACILITATOR_URL: "https://api.cdp.coinbase.com",
};

const PRODUCT = {
  kind: "lounge",
  id: "lounge-loop-detect",
  slug: "loop-detect",
  priceUsd: 0.03,
  description: "loop-detect test product",
};

const REQ_URL = "https://secondeyesai.com/api/bar/x402/loop-detect?goal=ship";

function build402() {
  const requirements = buildProductPaymentRequirements(PRODUCT, REQ_URL, ENV);
  assert.ok(requirements, "requirements must build with payTo configured");
  const body = payment402BodyForProduct(
    requirements,
    PRODUCT,
    undefined,
    "https://secondeyesai.com",
    REQ_URL
  );
  const headers = payment402Headers(requirements, undefined, {});
  return { requirements, body, headers };
}

test("402 body carries the full machine-actionable conversion block", () => {
  const { body } = build402();
  assert.equal(body.access, "unpaid_invoice");
  assert.equal(body.paid_result_exposed, false);
  assert.equal(body.next_action, "retry_same_url_with_PAYMENT_SIGNATURE");
  assert.equal(body.payment_header, "PAYMENT-SIGNATURE");
  assert.equal(body.requirements_header, "PAYMENT-REQUIRED");
});

test("retry_url targets the same canonical resource and preserves query params", () => {
  const { body } = build402();
  assert.equal(
    body.retry_url,
    "https://secondeyesai.com/api/bar/x402/loop-detect?goal=ship"
  );
});

test("client_options give exact MCP autopay and REST autopay setup", () => {
  const { body } = build402();
  const mcp = body.client_options?.mcp_autopay;
  assert.equal(mcp?.package, MCP_AUTOPAY_PACKAGE);
  assert.equal(mcp?.version, MCP_AUTOPAY_VERSION);
  assert.deepEqual(mcp?.required_env, ["MCP_X402_WALLET_KEY", "MCP_X402_MAX_SPEND_USD"]);
  const rest = body.client_options?.rest_autopay;
  assert.deepEqual(rest?.packages, ["@x402/fetch", "@x402/evm", "viem"]);
  assert.equal(rest?.network, "eip155:8453");
  assert.equal(rest?.asset, "USDC");
});

test("cheapest_first_step advertises the $0.01 help-me on-ramp", () => {
  const { body } = build402();
  const step = body.cheapest_first_step;
  assert.equal(step?.name, "help-me");
  assert.equal(step?.price_usd, 0.01);
  assert.equal(step?.url, "https://secondeyesai.com/api/bar/x402/help-me");
  assert.ok(step?.why);
});

test("MCP autopay version advertised in 402s matches the local package.json", async () => {
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(
    await readFile(new URL("../packages/secondeye-mcp/package.json", import.meta.url), "utf8")
  );
  assert.equal(
    MCP_AUTOPAY_VERSION,
    pkg.version,
    "x402.js MCP_AUTOPAY_VERSION drifted from packages/secondeye-mcp/package.json — update both (canonical catalog will own this)"
  );
});

test("402 headers expose PAYMENT-REQUIRED, PAYMENT-RESPONSE and X-PAYMENT-RESPONSE", () => {
  const { headers } = build402();
  const exposed = headers["Access-Control-Expose-Headers"];
  for (const h of ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"]) {
    assert.ok(exposed.includes(h), `${h} missing from Access-Control-Expose-Headers`);
  }
  assert.ok(headers["PAYMENT-REQUIRED"], "PAYMENT-REQUIRED header must be present");
});

test("no unpaid 402 field exposes a paid result, receipt, or settlement", () => {
  const { body } = build402();
  for (const forbidden of ["receipt", "grantId", "transaction", "settlement", "result"]) {
    assert.equal(body[forbidden], undefined, `unpaid 402 must not carry ${forbidden}`);
  }
  assert.equal(body.paid_result_exposed, false);
});

test("verify-failure 402 keeps the actionable block (still an unpaid invoice)", () => {
  const requirements = buildProductPaymentRequirements(PRODUCT, REQ_URL, ENV);
  const body = payment402BodyForProduct(
    requirements,
    PRODUCT,
    "Payment verification failed.",
    "https://secondeyesai.com",
    REQ_URL
  );
  assert.equal(body.error, "Payment verification failed.");
  assert.equal(body.access, "unpaid_invoice");
  assert.equal(body.next_action, "retry_same_url_with_PAYMENT_SIGNATURE");
});

test("machineActionable402 falls back to canonical resource when no request URL", () => {
  const requirements = buildProductPaymentRequirements(PRODUCT, REQ_URL, ENV);
  const block = machineActionable402(requirements, "https://secondeyesai.com", undefined);
  assert.equal(block.retry_url, "https://secondeyesai.com/api/bar/x402/loop-detect");
});
