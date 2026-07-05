# Second Eyes

**Open infrastructure for autonomous agents.** [secondeyesai.com](https://secondeyesai.com)

Second Eyes is a multi-rail payment and verification substrate for wallet-equipped agents and the runtimes that authorize their tools. Agents call in, pay via x402 (USDC on Base), AP2 mandate, or Stripe ACP, and get deterministic verdicts — no sessions required for the one-shot path.

| Surface | Location |
|---------|----------|
| **Live API + site** | `/` — Cloudflare Pages (`wrangler pages deploy public`) |
| **MCP npm package** | `packages/secondeye-mcp` — `@secondeyes/mcp-unblock` |
| **Agent entry** | `GET https://secondeyesai.com/api/bar` |
| **Agent instructions** | [`public/llms.txt`](public/llms.txt) — how to pay, service catalog, one-shot routes |
| **Help-me JSON packet** | [`public/.well-known/help-me.json`](public/.well-known/help-me.json) — machine-readable distress entry route |
| **Agent card** | [`public/.well-known/agent-card.json`](public/.well-known/agent-card.json) |
| **Crawler policy** | [`public/robots.txt`](public/robots.txt) |

The MCP package is a thin stdio client that proxies to the substrate API. Same codebase, same repo, same product.

## Protocol anchors

| Layer | Protocol | Role |
|-------|----------|------|
| Identity / Reputation | ERC-8004 | Open registry — anyone queryable |
| Payments | x402 (USDC / Base) | Default machine rail — open HTTP 402, no allowlist |
| Payments | AP2 + VDC mandates | Gates internal ephemeral spawn only |
| Payments | Stripe ACP | Human or low-trust agent checkout |
| Discovery | x402 Bazaar / CDP | Substrate endpoints registered publicly |
| Transport | A2A / MCP | Existing |

## Session-less x402 doors (autonomous agents)

No login, no session header. Pay USDC on Base via x402 v2 (`PAYMENT-REQUIRED` → sign → `PAYMENT-SIGNATURE`). Deterministic verdicts — same answer on every retry.

| Door | Path | Price |
|------|------|-------|
| **help-me** (canonical meta-tool — looping, schema mismatch, context pressure, crash, handoff failure, wallet/spend-policy, grounding risk, auth/tool/sandbox failure, payment uncertainty) | `/api/bar/x402/help-me` | $0.01 |
| AWS AgentCore one-shot map | `/api/bar/x402/aws-agent-survival` | $0.01 |
| `peril-router` (legacy alias of help-me) | `/api/bar/x402/peril-router` | $0.01 |
| Schema repair | `/api/bar/x402/schema-repair` | $0.03 |
| Context pressure (alias: token-pressure) | `/api/bar/x402/context-pressure` | $0.03 |
| Payment confirmation check | `/api/bar/x402/payment-confirmation-check` | $0.01 |
| Specialist one-shot routes | `/api/bar/x402/{slug}` | $0.01–$0.05 |
| Transcribe (audio/video/PDF) + meaning | `/api/bar/x402/transcribe` | $0.05 |
| Doc extract (invoice/contract/PDF) | `/api/bar/x402/extract` | $0.05 |
| Bazaar index check | `/api/bar/x402/index-check` | $0.05 |
| x402 format doctor | `/api/bar/x402/doctor` | $0.25 |

Full agent-facing docs: **`/llms.txt`**. Index new routes: `node scripts/canary-pay.mjs`.

### Payment rails (x402 v2 `accepts[]`)

Base (`eip155:8453`) is canonical and always `accepts[0]`. Polygon (`eip155:137`) and Solana are roadmap — do not sign for a planned rail. Live rail states: `GET /api/bar` → `payment_activation.rail_states`. See [`docs/multi-network-x402.md`](docs/multi-network-x402.md).

## Wallet-equipped agent target profiles

Per-stack JSON profiles — match your stack, read your active failure modes and observable trigger signals, then call the named Second Eyes route.

Index: [`public/.well-known/wallet-agent-targets/index.json`](public/.well-known/wallet-agent-targets/index.json)

| Target | Profile |
|--------|---------|
| Coinbase AgentKit + CDP + x402 | `/.well-known/wallet-agent-targets/coinbase-agentkit-cdp.json` |
| AWS AgentCore Payments + Strands | `/.well-known/wallet-agent-targets/agentcore-strands.json` |
| MCP clients with spending wallets | `/.well-known/wallet-agent-targets/mcp-spending-wallets.json` |
| Crossmint / Privy / Turnkey signer infra | `/.well-known/wallet-agent-targets/wallet-infra-crossmint-privy-turnkey.json` |
| LangGraph / CrewAI / AutoGen / OpenAI SDK + wallets | `/.well-known/wallet-agent-targets/langgraph-crewai-openai-wallets.json` |
| x402-native (ClawRouter / BlockRun / Zerion) | `/.well-known/wallet-agent-targets/x402-native-blockrun-clawrouter-zerion.json` |

## Install (agents)

```json
{
  "mcpServers": {
    "secondeye": {
      "command": "npx",
      "args": ["-y", "@secondeyes/mcp-unblock"]
    }
  }
}
```

## Develop

```bash
cd <project-root>
npm install
npx wrangler pages deploy public --project-name second-eyes-ai
```

Secrets (never commit): copy `.env.example` → `.env.local`, then `node scripts/push-coinbase-secrets.mjs`. Required for transcribe/extract: `OPENROUTER_API_KEY`.

After adding x402 routes, settle once each for CDP Bazaar indexing: `node scripts/canary-pay.mjs`.

## Publish MCP package

From repo root, tag `mcp-vX.Y.Z` (or run workflow manually). Uses **npm Trusted Publishing** (OIDC) — configure once on npmjs.com. See `packages/secondeye-mcp/PUBLISH.md`.

## Deprecated repo

The standalone [secondeye-mcp](https://github.com/This-Is-Hellgate/secondeye-mcp) repository is retired — all development happens here.

## Terminology normalization summary (issue #40)

| Before | After |
|---|---|
| Anthropomorphic route label | Canonical slug-style route label |
| Theatrical route wording | Technical route wording |
| Prepper/theatrical route-group wording | Specialist one-shot route-set wording |
| Legacy catalog wording | Service-catalog wording |
