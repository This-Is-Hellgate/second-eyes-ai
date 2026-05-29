#!/usr/bin/env node
/**
 * Integration check: MCP order_service x402 composition (no stdio MCP client).
 * Mirrors order_service flow: enter → unpaid probe → pay via x402-wallet module.
 *
 * Usage:
 *   MCP_X402_WALLET_KEY=<canary key> node scripts/mcp-order-pay-canary.mjs
 *   MCP_X402_WALLET_KEY=<key> node scripts/mcp-order-pay-canary.mjs --slug should-i-pay
 */
import { payAndRetryService, walletStatus } from "../src/x402-wallet.js";

const BASE = (process.env.SECOND_EYE_BASE_URL || "https://secondeyesai.com").replace(/\/$/, "");
const AGENT_ID = process.env.MCP_CANARY_AGENT_ID || "mcp-canary-001";
const slug = process.argv.includes("--slug")
  ? process.argv[process.argv.indexOf("--slug") + 1]
  : "should-i-pay";

async function api(path, { headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json", ...headers },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  console.log("wallet:", walletStatus());

  const enter = await api("/api/bar/enter", { headers: { "X-Agent-Id": AGENT_ID } });
  if (!enter.json?.session?.id) {
    throw new Error(`enter failed: ${enter.status} ${JSON.stringify(enter.json)}`);
  }
  const session_id = enter.json.session.id;
  console.log("session:", session_id);

  const path = `/api/bar/services/${slug}`;
  const unpaid = await api(path, { headers: { "X-Second-Eye-Session": session_id } });
  console.log("unpaid:", unpaid.status, unpaid.json?.product || unpaid.json?.error);

  if (unpaid.status !== 402) {
    throw new Error(`expected 402 before pay, got ${unpaid.status}`);
  }

  const paid = await payAndRetryService(`${BASE}${path}`, {
    session_id,
    slug,
    initial402: unpaid.json,
  });

  console.log("paid:", paid.status);
  console.log("x402:", paid.payment || paid.x402_error);
  console.log("grant:", paid.json?.grantId);
  console.log("receipt tx:", paid.json?.receipt?.transaction || paid.payment?.transaction);

  if (paid.status !== 200) {
    process.exit(1);
  }

  const proof = await api("/api/bar/proof/payments?limit=3");
  console.log("proof settlements:", proof.json?.payments_settled, proof.json?.recent_settlements?.length);
}

main().catch((e) => {
  console.error("MCP PAY CANARY FAILED:", e.message || e);
  process.exit(1);
});
