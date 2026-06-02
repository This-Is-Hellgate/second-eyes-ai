// test/x402-facilitator/mock-facilitator.mjs
// Records exactly what the real verify/settle paths (functions/_lib/x402.js) send
// to the CDP facilitator, so Layer 1 can assert the facilitator only ever sees
// ONE paymentRequirements object (the matching rail), never the full accepts[].
//
// Strategy: monkey-patch globalThis.fetch for the duration of a check. The repo's
// fetchWithTimeout (resilience.js) calls the global fetch, so this intercepts
// every facilitator-bound request without touching production code. Returns
// canned /verify and /settle responses; passes everything else through.

const DEFAULT_VERIFY = { isValid: true, payer: "0xMockPayer" };
const DEFAULT_SETTLE = {
  success: true,
  transaction:
    "0xMockTxHash000000000000000000000000000000000000000000000000000000",
  network: "eip155:8453",
  payer: "0xMockPayer",
};

// Bases that count as "the CDP facilitator". The repo default facilitator is
// https://api.cdp.coinbase.com/platform — facilitatorPaths() appends
// /v2/x402/{verify,settle}. We match on host so any test facilitator URL works.
const DEFAULT_FACILITATOR_HOSTS = [
  "api.cdp.coinbase.com",
  "x402-amoy.polygon.technology",
  "facilitator.x402.rs",
  "mock-facilitator.test",
];

export function installMockFacilitator(opts = {}) {
  const calls = [];
  const verifyResult = opts.verifyResult ?? DEFAULT_VERIFY;
  const settleResult = opts.settleResult ?? DEFAULT_SETTLE;
  const hosts = opts.facilitatorHosts ?? DEFAULT_FACILITATOR_HOSTS;

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;

    let host = "";
    try {
      host = new URL(url).host;
    } catch {
      host = "";
    }

    if (!hosts.some((h) => host === h || host.endsWith(`.${h}`) || host.includes(h))) {
      return originalFetch(input, init);
    }

    const endpoint = url.includes("/verify")
      ? "verify"
      : url.includes("/settle")
      ? "settle"
      : url.includes("/supported")
      ? "supported"
      : "other";

    let body = null;
    if (init?.body) {
      try {
        body = JSON.parse(init.body.toString());
      } catch {
        body = null;
      }
    }

    const auth =
      (init?.headers && new Headers(init.headers).get("authorization")) || undefined;

    calls.push({ endpoint, url, method: init?.method ?? "GET", body, authorization: auth });

    if (endpoint === "verify") {
      return jsonResponse(verifyResult);
    }
    if (endpoint === "settle") {
      return jsonResponse(settleResult);
    }
    if (endpoint === "supported") {
      return jsonResponse({
        kinds: [
          { scheme: "exact", network: "eip155:8453" },
          { scheme: "exact", network: "eip155:84532" },
          { scheme: "exact", network: "eip155:137" },
          { scheme: "exact", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" },
        ],
      });
    }
    return jsonResponse({});
  };

  return {
    calls,
    verifyCalls: () => calls.filter((c) => c.endpoint === "verify"),
    settleCalls: () => calls.filter((c) => c.endpoint === "settle"),
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Build a synthetic base64 PAYMENT-SIGNATURE header for a given network, WITHOUT
 * signing anything. The buyer echoes the rail it chose under `accepted.network`
 * (v2) — that is exactly what selectAcceptForPayload reads. No real key, no spend.
 */
export function makeSyntheticPaymentHeader(network, { topLevelOnly = false } = {}) {
  const payload = {
    x402Version: 2,
    scheme: "exact",
    network,
    ...(topLevelOnly ? {} : { accepted: { network } }),
    payload: {
      signature: "0x" + "00".repeat(65),
      authorization: {
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        value: "10000",
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 300),
        nonce: "0x" + "ab".repeat(32),
      },
    },
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}
