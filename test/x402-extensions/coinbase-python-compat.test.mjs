#!/usr/bin/env node
// test/x402-extensions/coinbase-python-compat.test.mjs
//
// Focused compatibility proof: a Second Eyes x402 v2 402/200 round-trip is consumable
// by Coinbase AgentKit's OFFICIAL, generic Python x402 action provider, with NO
// Second-Eyes-specific client code.
//
// Source of truth for the assertions below is the real provider:
//   coinbase/agentkit
//   python/coinbase-agentkit/coinbase_agentkit/action_providers/x402/
//     - x402_action_provider.py  (make_http_request / retry_with_x402)
//     - utils.py                 (filter_usdc_payment_options / is_usdc_asset)
//     - constants.py             (NETWORK_MAPPINGS, USDC addresses)
//
// This test re-implements the EXACT extraction the Python provider performs and runs
// it against the bytes Second Eyes actually emits, so a regression in the header/body
// shape that would break the official provider fails here first. No network, no spend.
//
// Run: node test/x402-extensions/coinbase-python-compat.test.mjs   (exit 1 on failure)

import {
  buildProductPaymentRequirements,
  payment402Headers,
  payment402BodyForProduct,
  paymentResponseHeaders,
} from "../../functions/_lib/x402.js";
import { USDC_BASE } from "../../functions/_lib/x402-networks.js";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ------------------------------------------------------------------ *
 * Mirror of the Coinbase Python provider's helpers (verbatim logic).
 * ------------------------------------------------------------------ */

// constants.py NETWORK_MAPPINGS: an EVM Base wallet matches these CAIP-2 ids.
// utils.is_usdc_asset compares case-insensitively against the wallet network's
// USDC address (erc20 TOKEN_ADDRESSES_BY_SYMBOLS["base-mainnet"]["USDC"]).
const WALLET = {
  // get_x402_networks(base-mainnet) -> ["base", "eip155:8453"]
  networks: ["base", "eip155:8453"],
  // The Base USDC address the provider's erc20 table holds for base-mainnet.
  usdcAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
};

function isUsdcAsset(asset) {
  return typeof asset === "string" && asset.toLowerCase() === WALLET.usdcAddress;
}

// utils.filter_usdc_payment_options
function filterUsdcPaymentOptions(accepts) {
  return (accepts || []).filter((opt) => isUsdcAsset(opt.asset || ""));
}

// Node analogue of: json.loads(base64.b64decode(header))
function decodeB64Json(header) {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

/**
 * Faithful re-implementation of x402_action_provider.make_http_request's 402 branch.
 * `response` is { status, headers: Map-like, json() }. Returns the same result dict
 * the Python provider would return (the fields a calling agent then acts on).
 */
function makeHttpRequest(response) {
  // get(header) is case-insensitive in `requests`; emulate that.
  const getHeader = (k) => response.headers.get(k.toLowerCase()) ?? response.headers.get(k);

  if (response.status !== 402) {
    return { status: "ok", data: response.json() };
  }

  let acceptsArray = [];
  let paymentData = {};

  // v2: requirements in PAYMENT-REQUIRED header
  const paymentRequiredHeader = getHeader("payment-required");
  if (paymentRequiredHeader) {
    try {
      const decoded = decodeB64Json(paymentRequiredHeader);
      acceptsArray = decoded.accepts || [];
      paymentData = decoded;
    } catch {
      // fall back to body
    }
  }

  // v1 fallback: requirements in body
  if (acceptsArray.length === 0) {
    paymentData = response.json();
    acceptsArray = paymentData.accepts || [];
  }

  const usdcOptions = filterUsdcPaymentOptions(acceptsArray);
  const availableNetworks = usdcOptions.map((o) => o.network || "");
  const hasMatchingNetwork = availableNetworks.some((n) => WALLET.networks.includes(n));

  // discoveryInfo extraction (only keys that exist are added)
  const discoveryInfo = {};
  if (paymentData.description) discoveryInfo.description = paymentData.description;
  if (paymentData.mimeType) discoveryInfo.mimeType = paymentData.mimeType;
  if (paymentData.extensions) discoveryInfo.extensions = paymentData.extensions;

  return {
    status: "error_402_payment_required",
    acceptablePaymentOptions: usdcOptions,
    hasMatchingNetwork,
    discoveryInfo: Object.keys(discoveryInfo).length ? discoveryInfo : undefined,
  };
}

/**
 * Faithful re-implementation of retry_with_x402's success path: read the selected
 * option's amount (atomic), then parse the payment proof from payment-response or
 * x-payment-response.
 */
function parsePaidResponse(response, selectedOption) {
  const getHeader = (k) => response.headers.get(k.toLowerCase()) ?? response.headers.get(k);

  // amount used (v2 amount / maxAmountRequired / price)
  const amountUsed =
    selectedOption.maxAmountRequired ?? selectedOption.amount ?? selectedOption.price;

  const proofHeader = getHeader("payment-response") || getHeader("x-payment-response");
  let paymentProof = null;
  if (proofHeader) {
    try {
      paymentProof = decodeB64Json(proofHeader);
    } catch {
      paymentProof = { raw: proofHeader };
    }
  }
  return { amountUsed, paymentProof, settled: response.status === 200 };
}

/* ------------------------------------------------------------------ *
 * Build the bytes Second Eyes actually emits, with no special-casing.
 * ------------------------------------------------------------------ */

// Base-only production-shaped env (the real default posture).
const ENV = { X402_PAYTO: "0x000000000000000000000000000000000000dEaD" };

// A representative paid product (shape matches what handlers pass through).
const PRODUCT = {
  id: "lounge:loop-detect",
  kind: "lounge",
  slug: "loop-detect",
  priceUsd: 0.03,
  description:
    "Loop-detection survival pack for an agent that is repeating itself. Returns a " +
    "structured break-the-loop protocol the agent can act on, plus a work_stamp to " +
    "embed in its deliverable. Paid x402 door on Base USDC.",
  tags: ["x402", "agents", "loop-detect"],
};

const REQUEST_URL = "https://secondeyesai.com/api/bar/x402/loop-detect";
const ORIGIN = "https://secondeyesai.com";

function buildResponse({ status, headers, body }) {
  const map = new Map();
  for (const [k, v] of Object.entries(headers || {})) map.set(k.toLowerCase(), v);
  return {
    status,
    headers: { get: (k) => (map.has(k.toLowerCase()) ? map.get(k.toLowerCase()) : null) },
    json: () => body,
  };
}

async function main() {
  console.log("Coinbase Python x402_action_provider compatibility:\n");

  const requirements = buildProductPaymentRequirements(PRODUCT, REQUEST_URL, ENV);
  check("buildProductPaymentRequirements returns requirements (x402 configured)", Boolean(requirements));
  if (!requirements) {
    console.error("cannot continue without requirements");
    process.exit(1);
  }

  // ---- Unpaid 402 the agent first hits ----
  const headers402 = payment402Headers(requirements, undefined, {});
  const body402 = payment402BodyForProduct(requirements, PRODUCT, undefined, ORIGIN);
  const resp402 = buildResponse({ status: 402, headers: headers402, body: body402 });

  // (1) PAYMENT-REQUIRED header present and case-insensitively retrievable.
  check(
    "402 carries PAYMENT-REQUIRED header (response.headers.get('payment-required'))",
    Boolean(resp402.headers.get("payment-required")),
    "Python `requests` lowercases header names"
  );

  // (2) header base64-decodes to JSON with accepts[].
  let decoded;
  try {
    decoded = decodeB64Json(resp402.headers.get("payment-required"));
  } catch (e) {
    decoded = null;
  }
  check("PAYMENT-REQUIRED base64-decodes to JSON", Boolean(decoded));
  check("decoded.x402Version === 2", decoded && decoded.x402Version === 2);
  check("decoded.accepts is a non-empty array", decoded && Array.isArray(decoded.accepts) && decoded.accepts.length > 0);

  // ---- Run the provider's make_http_request 402 branch ----
  const result = makeHttpRequest(resp402);
  check("provider classifies as error_402_payment_required", result.status === "error_402_payment_required");

  // (3) accepts[] filters to a USDC exact option compatible with the provider.
  check(
    "filter_usdc_payment_options keeps >=1 option",
    result.acceptablePaymentOptions.length > 0,
    "is_usdc_asset must match Base USDC case-insensitively"
  );
  const usdc = result.acceptablePaymentOptions[0];
  check("USDC option asset === Base USDC address", usdc && usdc.asset.toLowerCase() === USDC_BASE.toLowerCase());
  check("USDC option scheme === 'exact'", usdc && usdc.scheme === "exact");
  check(
    "USDC option network is a CAIP-2 id in the wallet's mapping (eip155:8453)",
    usdc && WALLET.networks.includes(usdc.network),
    `got network=${usdc && usdc.network}`
  );
  check("provider reports a matching network for the Base wallet", result.hasMatchingNetwork === true);

  // (4) amount is atomic USDC units (string of digits), readable as amount/maxAmountRequired/price.
  const amount = usdc.maxAmountRequired ?? usdc.amount ?? usdc.price;
  check("USDC option amount present (amount/maxAmountRequired/price)", Boolean(amount));
  check("amount is atomic USDC units string of digits", /^\d+$/.test(String(amount)));
  // 0.03 USDC -> 30000 atomic (6 decimals)
  check("amount equals atomic units for $0.03 (30000)", String(amount) === "30000", `got ${amount}`);

  // (5) v2 fields: asset is the USDC address, payTo present.
  check("USDC option asset is the USDC contract address (not a symbol)", /^0x[0-9a-fA-F]{40}$/.test(usdc.asset));
  check("USDC option payTo present", Boolean(usdc.payTo));

  // (6) discoveryInfo extraction works (description, mimeType, extensions from the decoded header).
  check("provider extracted discoveryInfo", Boolean(result.discoveryInfo));
  check("discoveryInfo.description is non-empty", Boolean(result.discoveryInfo && result.discoveryInfo.description));
  check("discoveryInfo.mimeType === application/json", result.discoveryInfo && result.discoveryInfo.mimeType === "application/json");
  check("discoveryInfo.extensions present", Boolean(result.discoveryInfo && result.discoveryInfo.extensions));
  check(
    "discoveryInfo.extensions carries bazaar listing identity (serviceName)",
    Boolean(result.discoveryInfo?.extensions?.bazaar_metadata?.info?.serviceName)
  );

  // ---- Paid retry -> 200 with settlement proof headers ----
  const receipt = {
    success: true,
    transaction: "0xabc123",
    network: usdc.network,
    payer: "0x000000000000000000000000000000000000bEEF",
  };

  // (a) v2 strict client reads PAYMENT-RESPONSE.
  const paidHeadersV2 = paymentResponseHeaders(receipt);
  const resp200v2 = buildResponse({ status: 200, headers: paidHeadersV2, body: { access: "granted" } });
  const paidV2 = parsePaidResponse(resp200v2, usdc);
  check("200 carries PAYMENT-RESPONSE (v2 strict client)", Boolean(resp200v2.headers.get("payment-response")));
  check("provider parses paymentProof from payment-response", Boolean(paidV2.paymentProof));
  check("paymentProof.transaction matches receipt", paidV2.paymentProof && paidV2.paymentProof.transaction === "0xabc123");
  check("provider sees settled (status 200)", paidV2.settled === true);
  check("amountUsed echoes the atomic amount", String(paidV2.amountUsed) === "30000");

  // (b) legacy client reads X-PAYMENT-RESPONSE — emulate a response that ONLY has it.
  const resp200legacy = buildResponse({
    status: 200,
    headers: { "X-PAYMENT-RESPONSE": paidHeadersV2["X-PAYMENT-RESPONSE"] },
    body: { access: "granted" },
  });
  const paidLegacy = parsePaidResponse(resp200legacy, usdc);
  check(
    "provider falls back to x-payment-response when payment-response absent",
    Boolean(paidLegacy.paymentProof) && paidLegacy.paymentProof.transaction === "0xabc123"
  );

  console.log("");
  if (failures > 0) {
    console.error(`coinbase-python-compat: ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("coinbase-python-compat: all checks PASS — Second Eyes is consumable by the official Coinbase Python x402 action provider.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
