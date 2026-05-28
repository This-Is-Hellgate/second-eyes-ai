# Official MCP Registry

**server.json:** `./server.json` in repo root

**Namespace:** `io.github.This-Is-Hellgate/secondeye-mcp-unblock` (casing matters)

## Publish steps

```bash
cd secondeye-mcp
npm install -g @modelcontextprotocol/registry-cli   # or use npx
mcp-publisher login github
mcp-publisher publish
```

Requires GitHub OAuth and repo `This-Is-Hellgate/second-eyes-ai` (packages/secondeye-mcp) with this `server.json` committed.

## npm publish (optional, for stdio package)

```bash
npm publish --access public
```

Package: `@secondeyes/mcp-unblock@1.0.5`

## Search-optimized title

**MCP 401 Auth Fix | github PAT wiring | x402 proof required**

## Search tags (in server.json _meta)

401, github-mcp, cursor-mcp, PAT, x402, usdc, unblock, mcp-wiring, claim-check, should-i-pay
