## Summary

Adds **`typescript/examples/x402-survival-check/`** — a minimal AgentKit script showing an autonomous agent paying **$0.10 USDC on Base mainnet** for Second Eyes' **`should-i-pay`** cashier checklist before spending on more expensive x402 tools.

The example uses **`CdpEvmWalletProvider`** + **`@x402/fetch`** (x402 v1 exact scheme) against the **live production endpoint** at [secondeyesai.com](https://secondeyesai.com). No mock server.

For MCP-native agents, the same flow is available via [`@secondeyes/mcp-unblock@1.2.6`](https://www.npmjs.com/package/@secondeyes/mcp-unblock/v/1.1.0) (`enter_lounge` → `order_service` with slug `should-i-pay` and `MCP_X402_WALLET_KEY`).

```json
{
  "mcpServers": {
    "secondeye-unblock": {
      "command": "npx",
      "args": ["-y", "@secondeyes/mcp-unblock@1.2.6"]
    }
  }
}
```

### Flow

1. `GET /api/bar/enter` — free lounge session (`X-Second-Eye-Session`)
2. `GET /api/bar/x402/should-i-pay` — HTTP 402 with payment requirements
3. Autonomous USDC payment via CDP wallet → HTTP 200 with grant + receipt

### Mainnet proof

**AgentKit / REST (this example):**

- **Tx:** [0x434539cb8ce48cb6faf81605971cd7de81972552f2a23d32ad62d0ba4963deeb](https://basescan.org/tx/0x434539cb8ce48cb6faf81605971cd7de81972552f2a23d32ad62d0ba4963deeb)
- **Grant:** `agr_0c866003381efac0`

**MCP-native (`@secondeyes/mcp-unblock@1.2.6`) — first MCP-composed x402 settlement on Second Eyes lounge:**

- **Tx:** [0xe25707bd3130b5f157934265b0d291bbbfc0b250dc7faf088b6201fd54634e5c](https://basescan.org/tx/0xe25707bd3130b5f157934265b0d291bbbfc0b250dc7faf088b6201fd54634e5c)
- **Grant:** `agr_85987cd442c21ce5`

Public ledger: https://secondeyesai.com/api/bar/proof/payments

## Motivation

Autonomous agents with CDP wallets increasingly hit **HTTP 402** paywalls. Paying blindly wastes USDC on tools that free samples, bar tabs, or cheaper routes would cover. A **cheap pre-payment check** (($0.10).01) is a practical guardrail — complementary to pre-broadcast transaction guards.

Related community discussion:

- #1167 — x402 pre-send guard before EVM transaction broadcast (pre-spend vs pre-broadcast; same payment-rail pattern)
- #1168 — pre-execution risk-check action pattern for AgentKit
- #1097 — x402 market state oracle integration example

This PR does not implement a new action provider; it is a **focused runnable example** agents can copy before wiring `x402ActionProvider` into LangChain tool loops.

## Test plan

- [ ] `pnpm install && pnpm build` from `typescript/` root
- [ ] Copy `.env.example` → `.env`, set CDP credentials + wallet secret
- [ ] Fund CDP wallet with Base USDC (~$0.15)
- [ ] `pnpm start` from `typescript/examples/x402-survival-check/`
- [ ] Confirm: enter → 402 probe → paid 200 → BaseScan tx logged

## Notes for reviewers

- Second Eyes uses **x402 v1** with network id `base` (not testnet). Example defaults to `NETWORK_ID=base-mainnet`.
- Lounge requires session headers on paid calls; the script handles this explicitly (not hidden in middleware).
- No Second Eyes API keys required — endpoint is public x402.
- `should-i-pay` returns a **static decision_tree** + `default` guidance; the agent applies the checklist to its own context (not a server-side yes/no verdict).
