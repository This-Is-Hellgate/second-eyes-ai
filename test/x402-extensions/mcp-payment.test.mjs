#!/usr/bin/env node
// test/x402-extensions/mcp-payment.test.mjs
// Unit tests for the MCP x402 payment channel in functions/_lib/mcp-facade.js
// (teardown item 2b). No network, no spend — handleMcpPost is called directly with
// a synthetic env carrying X402_PAYTO so payment requirements build.
//
// Asserts:
//   - tools/list still works
//   - paid tool order_service WITHOUT _meta["x402/payment"] → MCP error -32402
//     carrying a v2 PaymentRequired object (x402Version:2, accepts[], eip155:8453)
//   - the unpaid error names PAYMENT-SIGNATURE and the _meta channel
//   - an unknown slug → -32602
//
// Settling a real payment needs the CDP facilitator (covered by the facilitator
// layer tests), so this test asserts the unpaid/quote path only.
//
// Run: node test/x402-extensions/mcp-payment.test.mjs   (exit 1 on any failure)

import { handleMcpPost, MCP_X402_META_KEY } from "../../functions/_lib/mcp-facade.js";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ORIGIN = "https://secondeyesai.com";
const ENV = { X402_PAYTO: "0x000000000000000000000000000000000000dEaD" };

function req(body) {
  return new Request(`${ORIGIN}/api/bar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function main() {
  // tools/list
  const list = await handleMcpPost(req({ jsonrpc: "2.0", id: 1, method: "tools/list" }), ORIGIN, ENV);
  check("tools/list returns tools array", Array.isArray(list.payload?.result?.tools));
  check("tools/list includes order_service", list.payload.result.tools.some((t) => t.name === "order_service"));

  // Unpaid order_service → -32402 with PaymentRequired in _meta
  const unpaid = await handleMcpPost(
    req({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "order_service", arguments: { slug: "loop-detect" } } }),
    ORIGIN,
    ENV
  );
  const err = unpaid.payload?.error;
  check("unpaid paid-tool returns an error", !!err);
  check("error code is -32402 (payment required)", err?.code === -32402);
  const meta = err?.data?.[MCP_X402_META_KEY];
  check("error carries _meta[x402/payment]", !!meta);
  check("_meta status payment-required", meta?.status === "payment-required");
  check("_meta carries x402Version:2", meta?.x402Version === 2);
  check("_meta accepts[] is non-empty", Array.isArray(meta?.accepts) && meta.accepts.length > 0);
  check("_meta accepts[0] is Base eip155:8453", meta?.accepts?.[0]?.network === "eip155:8453");
  check("_meta resource object has url", typeof meta?.resource?.url === "string");
  check("_meta names PAYMENT-SIGNATURE", JSON.stringify(meta).includes("PAYMENT-SIGNATURE"));
  check("_meta carries extensions (bazaar/payment_identifier)", !!meta?.extensions?.payment_identifier);

  // Unknown slug → -32602
  const bad = await handleMcpPost(
    req({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "order_service", arguments: { slug: "no-such-slug" } } }),
    ORIGIN,
    ENV
  );
  check("unknown slug → -32602", bad.payload?.error?.code === -32602);

  // Missing slug → -32602
  const noslug = await handleMcpPost(
    req({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "order_service", arguments: {} } }),
    ORIGIN,
    ENV
  );
  check("missing slug → -32602", noslug.payload?.error?.code === -32602);

  // Free read tool still proxies (no payment) — mock fetch via global override.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ pass: true }), { status: 200 });
  try {
    const read = await handleMcpPost(
      req({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "read_laws" } }),
      ORIGIN,
      ENV
    );
    check("free read tool returns content (no payment)", Array.isArray(read.payload?.result?.content));
  } finally {
    globalThis.fetch = realFetch;
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll MCP x402 payment checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
