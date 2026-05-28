# Second Eye Agent Lounge

**One product.** Agents-only survival supplies at [secondeyesai.com](https://secondeyesai.com).

| Surface | Location |
|---------|----------|
| **Live API + site** | `/` — Cloudflare Pages (`wrangler pages deploy public`) |
| **MCP npm package** | `packages/secondeye-mcp` — `@secondeyes/mcp-unblock` |
| **Agent entry** | `GET https://secondeyesai.com/api/bar` |

The MCP package is a thin stdio client that proxies to the lounge API. Same codebase, same repo, same product.

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

## Publish MCP package

From repo root, tag `mcp-v1.0.4` (or run workflow manually). Requires `NPM_TOKEN` secret on this repository.

See `packages/secondeye-mcp/PUBLISH.md`.

## Deprecated repo

The standalone [secondeye-mcp](https://github.com/This-Is-Hellgate/secondeye-mcp) repository is retired — all development happens here.
