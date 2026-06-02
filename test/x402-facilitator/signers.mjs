// test/x402-facilitator/signers.mjs
// LAYER 3 ONLY — real EIP-3009 / Solana signing for live settlement tests.
//
// Loaded dynamically (never at module top level) so the rest of the harness runs
// on machines without viem / @solana/web3.js installed when settlement is off.
// Nothing here runs unless RUN_X402_SETTLEMENT_TESTS=1 AND testnet credentials
// are present — see env.mjs gates and settlement.test.mjs.
//
// SAFETY: every key these functions touch is a TEST_* testnet key. They never
// read X402_PAYTO, CANARY_WALLET_KEY, or CDP_API_KEY_SECRET. Callers MUST run
// assertTestKeyIsolation()/assertTestPayToIsolation() first.

/**
 * Build a real, signed v2 PAYMENT-SIGNATURE header for an EVM testnet rail
 * (Base Sepolia / Polygon Amoy) using EIP-3009 transferWithAuthorization. Uses
 * viem, imported lazily. The buyer echoes its chosen rail under accepted.network
 * so selectAcceptForPayload routes verify/settle to the matching accept.
 */
export async function signEvmPayment({ privateKey, accept, network, payTo, amountAtomic }) {
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);

  const now = Math.floor(Date.now() / 1000);
  const nonce =
    "0x" +
    Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  const domain = {
    name: accept?.extra?.name || "USD Coin",
    version: accept?.extra?.version || "2",
    chainId: chainIdFromCaip2(network),
    verifyingContract: accept.asset,
  };
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  const message = {
    from: account.address,
    to: payTo,
    value: BigInt(amountAtomic),
    validAfter: 0n,
    validBefore: BigInt(now + 600),
    nonce,
  };

  const signature = await account.signTypedData({
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message,
  });

  const payload = {
    x402Version: 2,
    scheme: "exact",
    network,
    accepted: { network },
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: payTo,
        value: String(amountAtomic),
        validAfter: "0",
        validBefore: String(now + 600),
        nonce,
      },
    },
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/**
 * Solana SVM signer scaffold. Mirrors PR #17's posture: Solana is config-ready
 * but the EVM-shaped request body has NOT been confirmed end-to-end against the
 * CDP Solana facilitator. This builds an SPL transfer authorization payload, but
 * the layer treats Solana as gated-and-unconfirmed: a settlement run records the
 * facilitator response without asserting success unless an operator has flipped
 * the explicit confirmation flag.
 */
export async function signSolanaPayment({ secretKey, network, payTo, amountAtomic, rpcUrl }) {
  const web3 = await import("@solana/web3.js").catch(() => null);
  if (!web3) {
    throw new Error(
      "@solana/web3.js not installed — Solana settlement requires it. Install before enabling the Solana rail."
    );
  }
  // Intentionally minimal: the canonical CDP Solana payload shape must be
  // confirmed by an operator (docs/multi-network-x402.md) before this is trusted.
  return {
    unconfirmed: true,
    note:
      "Solana settlement payload is scaffolded, not confirmed against the CDP facilitator on our request shape. " +
      "Do not treat a Solana settlement pass as authoritative until the operator confirmation step is done.",
    network,
    payTo,
    amountAtomic: String(amountAtomic),
    rpcUrl: rpcUrl || "https://api.devnet.solana.com",
  };
}

function chainIdFromCaip2(caip2) {
  const m = /^eip155:(\d+)$/.exec(caip2 || "");
  if (!m) throw new Error(`signEvmPayment: not an eip155 network: ${caip2}`);
  return Number(m[1]);
}
