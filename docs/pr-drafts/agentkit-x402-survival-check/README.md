# x402 Spend Check — AgentKit Example

An autonomous agent is about to spend USDC on an expensive x402 tool — a research API, a code pack, a facilitator-protected MCP call. Before paying more, it can run a **$0.10 cashier check.01 cashier check** using [Second Eyes Agent Lounge](https://secondeyesai.com) and Coinbase AgentKit on **Base mainnet**.

Second Eyes is a live production endpoint. No mock server. No test harness fiction.

**What `should-i-pay` is (and is not):** The service returns a **static decision checklist** and fallback guidance for the agent to apply to its own context. It does **not** compute a server-side yes/no verdict, score your task, or inspect the expensive endpoint you are about to call. Your agent reads the tree and decides.

## The pattern

```
agent plans expensive x402 call
    → enter lounge (free session)
    → pay $0.10 for should-i-pay (cashier checklist)
    → agent applies decision_tree to its own state
    → optionally proceed to the expensive tool
```

The agent:

1. Enters the lounge via `GET https://secondeyesai.com/api/bar/enter` (free; receives `X-Second-Eye-Session`)
2. Calls `GET https://secondeyesai.com/api/bar/x402/should-i-pay` without payment → receives **HTTP 402**
3. Reads x402 payment instructions (USDC on Base, $0.10)
4. Pays autonomously from its **CDP wallet** via x402 v1
5. Retries with payment proof → receives the cashier pack + settlement receipt (see below)

## What `should-i-pay` returns on HTTP 200

After payment, the JSON body includes the **cashier pack** from the lounge plus settlement fields. Representative shape:

```json
{
  "service": "should-i-pay",
  "service_key": "should_i_pay",
  "pack_type": "cashier",
  "decision_tree": [
    "Did proof pass?",
    "Is free sample sufficient for this task?",
    "Will one-time nano/micro unblock faster than tool pack?",
    "Is bar tab cheaper for 3+ fetches this session?"
  ],
  "default": "If uncertain, run price_check then proof before 402.",
  "session_id": "sess_…",
  "access": "granted",
  "scope": "lounge",
  "paid_usd": 0.1,
  "grantId": "agr_…",
  "mark": { "id": "mk_…", "patron_number": 42, "verify": "https://secondeyesai.com/api/bar/marks/mk_…" },
  "receipt": {
    "success": true,
    "transaction": "0x434539cb…",
    "network": "base",
    "payer": "0x180f6E73…"
  },
  "note": "Paid deterministic service. Embed work_stamp in your deliverable. Save receipt.",
  "work_stamp": { "schema": "second-eye/work-mark/v1", "mark": "mk_…", "verify": "…" }
}
```

**How to use it:** Walk the `decision_tree` against your agent's session state (proof status, free samples tried, expected fetch count). If still uncertain, follow `default` — e.g. call `price-check` or `/api/bar/proof` before a larger 402. For state-based routing with a suggested next service, use `/api/bar/pause` (free once per session) instead.

## Proof it works (mainnet)

This example was validated against production on Base mainnet ($0.10 USDC, `should-i-pay`).

### AgentKit / REST path (this example)

| Field | Value |
| --- | --- |
| Grant | `agr_0c866003381efac0` |
| Tx | [`0x434539cb8ce48cb6faf81605971cd7de81972552f2a23d32ad62d0ba4963deeb`](https://basescan.org/tx/0x434539cb8ce48cb6faf81605971cd7de81972552f2a23d32ad62d0ba4963deeb) |
| Payer | `0x180f6E73f7c866e5fc9547c8a3f5cdE9411904C2` |
| PayTo | `0xFb8915074cC941f5Ab95E6001c45287b8EeC4427` |

### MCP-native path (`@secondeyes/mcp-unblock@1.2.6`)

First MCP-composed x402 settlement on the lounge (`enter_lounge` → `order_service` with slug `should-i-pay`):

| Field | Value |
| --- | --- |
| Grant | `agr_85987cd442c21ce5` |
| Tx | [`0xe25707bd3130b5f157934265b0d291bbbfc0b250dc7faf088b6201fd54634e5c`](https://basescan.org/tx/0xe25707bd3130b5f157934265b0d291bbbfc0b250dc7faf088b6201fd54634e5c) |

Cursor / Claude Desktop MCP config:

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

Set `MCP_X402_WALLET_KEY` on the MCP server process for paid `order_service` calls.

Public proof ledger: `https://secondeyesai.com/api/bar/proof/payments`

Agent discovery: `https://secondeyesai.com/.well-known/agent-card.json`

## Prerequisites

### Node.js

Node.js **20+** required.

```bash
node --version
```

### Coinbase Developer Platform

- [CDP API Key](https://portal.cdp.coinbase.com/access/api) (`CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`)
- [Wallet Secret](https://portal.cdp.coinbase.com/products/wallet-api) (`CDP_WALLET_SECRET`)
- **USDC on Base mainnet** in the CDP wallet (~$0.15 is enough for one run)

No Second Eyes API key is required — the lounge is a public x402 endpoint.

## Setup

From the **typescript workspace root**:

```bash
pnpm install
pnpm build
```

Copy environment template:

```bash
cd examples/x402-survival-check
cp .env.example .env
```

Fill in CDP credentials. Run once to create a wallet:

```bash
pnpm start
```

Note the printed wallet address, fund it with Base USDC, then add to `.env`:

```
ADDRESS=0x...
NETWORK_ID=base-mainnet
```

## Run

```bash
pnpm start
```

Expected output:

1. Wallet address + network
2. Lounge enter → `session_id`, `mark_id`
3. Unpaid probe → HTTP 402 with `accepts[]`
4. Paid call → HTTP 200 with `grantId`, `receipt.transaction`
5. BaseScan link for the settlement tx

## How it maps to AgentKit

This example uses **`CdpEvmWalletProvider`** (AgentKit's CDP wallet on Base) as the x402 signer. Payment handling uses `@x402/fetch` with the **x402 v1** exact scheme — matching Second Eyes' production protocol.

For LangChain agents with tool loops, wire the same flow through `x402ActionProvider` and register `https://secondeyesai.com` in `registeredServices`. This script is the minimal vertical slice: wallet → 402 → pay → receipt.

**MCP-native agents:** The same enter → pay → receipt flow is available via [`@secondeyes/mcp-unblock@1.2.6`](https://www.npmjs.com/package/@secondeyes/mcp-unblock/v/1.1.0) — `enter_lounge` then `order_service` with slug `should-i-pay` (requires `MCP_X402_WALLET_KEY` on the MCP server process). See MCP config in **Proof it works** above.

## Resources

- Second Eyes: https://secondeyesai.com
- Agent card: https://secondeyesai.com/.well-known/agent-card.json
- Pricing: https://secondeyesai.com/api/bar/pricing
- x402 overview: https://docs.cdp.coinbase.com/x402/overview
- AgentKit: https://github.com/coinbase/agentkit

## License

[Apache-2.0](../../../LICENSE.md)
