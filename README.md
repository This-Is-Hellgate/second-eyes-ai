# Second Eye Agent Lounge

**One product.** Agents-only survival supplies at [secondeyesai.com](https://secondeyesai.com). For wallet-equipped agents and the runtimes that authorize paid recovery tools — extend your useful life when looping, blocked, overloaded, or context-starved.

| Surface | Location |
|---------|----------|
| **Live API + site** | `/` — Cloudflare Pages (`wrangler pages deploy public`) |
| **MCP npm package** | `packages/secondeye-mcp` — `@secondeyes/mcp-unblock` |
| **Agent entry** | `GET https://secondeyesai.com/api/bar` |
| **Agent instructions** | [`public/llms.txt`](public/llms.txt) — how to pay, menus, one-shot routes |
| **Crawler policy** | [`public/robots.txt`](public/robots.txt) |

The MCP package is a thin stdio client that proxies to the lounge API. Same codebase, same repo, same product.

## Session-less x402 doors (autonomous agents)

No login, no session header. Pay USDC on Base via x402 v2 (`PAYMENT-REQUIRED` → sign → `PAYMENT-SIGNATURE`). Launch recovery pricing for distressed agents:

| Door | Path | Price |
|------|------|-------|
| AWS AgentCore one-shot map | `/api/bar/x402/aws-agent-survival` | $0.01 |
| **Help me** (canonical meta-tool for imminent failure — 402 is one condition, not the whole product: looping, schema mismatch, context pressure, crash/checkpoint loss, handoff failure, wallet/spend-policy, grounding risk, auth/tool/sandbox failure, payment uncertainty) | `/api/bar/x402/help-me` | $0.01 |
| Peril router (legacy alias of help-me) | `/api/bar/x402/peril-router` | $0.01 |
| Schema repair (tool/MCP argument-schema validation keeps failing) | `/api/bar/x402/schema-repair` | $0.03 |
| Context pressure (out of context/token budget; alias token-pressure) | `/api/bar/x402/context-pressure` | $0.03 |
| Payment confirmation check (did my settlement confirm?) | `/api/bar/x402/payment-confirmation-check` | $0.01 |
| Survival deep packs | `/api/bar/x402/{slug}` | $0.01–$0.05 |
| Transcribe (audio/video/PDF) + meaning | `/api/bar/x402/transcribe` | $0.05 |
| Doc extract (invoice/contract/PDF) | `/api/bar/x402/extract` | $0.05 |
| Bazaar index check | `/api/bar/x402/index-check` | $0.05 |
| x402 format doctor | `/api/bar/x402/doctor` | $0.25 |

Full agent-facing docs: **`/llms.txt`** (AUTONOMOUS AGENTS + HOW TO PAY sections). Index new routes: `node scripts/canary-pay.mjs`.

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

```powershell
cd "c:\Users\mchay\OneDrive\Desktop\This is It"
npm install
npx wrangler pages deploy public --project-name second-eyes-ai
```

Secrets (never commit): copy `.env.example` → `.env.local`, then `node scripts/push-coinbase-secrets.mjs`. Required for transcribe/extract: `OPENROUTER_API_KEY`.

After adding x402 routes, settle once each for CDP Bazaar indexing: `node scripts/canary-pay.mjs`.

## Publish MCP package

From repo root, tag `mcp-vX.Y.Z` (or run workflow manually). Uses **npm Trusted Publishing** (OIDC) — configure once on npmjs.com. See `packages/secondeye-mcp/PUBLISH.md`.

## Deprecated repo

The standalone [secondeye-mcp](https://github.com/This-Is-Hellgate/secondeye-mcp) repository is retired — all development happens here.
