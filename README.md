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

No login, no session header. Pay USDC on Base via x402 v2 (`PAYMENT-REQUIRED` → sign → `PAYMENT-SIGNATURE`):

| Door | Path | Price |
|------|------|-------|
| Peril router | `/api/bar/x402/peril-router` | $0.10 |
| Transcribe + meaning | `/api/bar/x402/transcribe` | $0.10 |
| Doc extract | `/api/bar/x402/extract` | $0.10 |
| Survival deep packs | `/api/bar/x402/{slug}` | $0.10–$0.50 |

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
