# Smithery publish — @secondeyes/mcp-unblock

Docs: https://smithery.ai/docs/build/publish

## Prerequisites

1. API key from https://smithery.ai → Settings → API Keys  
   Or: `npx @smithery/cli auth login`
2. `/api/bar` must accept MCP POST (streamable HTTP) — deployed on secondeyesai.com
3. Static scan fallback: https://secondeyesai.com/.well-known/mcp/server-card.json

## Publish (PowerShell)

```powershell
cd packages/secondeye-mcp

$env:SMITHERY_API_KEY = "your-key-here"

npx @smithery/cli mcp publish `
  "https://secondeyesai.com/api/bar" `
  -n "@secondeyes/mcp-unblock"
```

Alternative qualified name (GitHub org style):

```powershell
npx @smithery/cli mcp publish `
  "https://secondeyesai.com/api/bar" `
  -n "@This-Is-Hellgate/secondeye-mcp-unblock"
```

## Optional config schema (SECOND_EYE_BASE_URL)

```powershell
$schema = '{"type":"object","properties":{"SECOND_EYE_BASE_URL":{"type":"string","default":"https://secondeyesai.com","description":"Second Eyes lounge base URL"}}}'

npx @smithery/cli mcp publish `
  "https://secondeyesai.com/api/bar" `
  -n "@secondeyes/mcp-unblock" `
  --config-schema $schema
```

## Verify before publish

```powershell
# MCP initialize (must return 200, not 405)
$body = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
Invoke-RestMethod -Uri "https://secondeyesai.com/api/bar" -Method POST -ContentType "application/json" -Body $body

# Static server card
Invoke-RestMethod "https://secondeyesai.com/.well-known/mcp/server-card.json"
```

## stdio install (full tools)

Remote URL is for discovery/Smithery gateway. Full paid/session tools via npm.

**HOW TO PAY:** https://secondeyesai.com/llms.txt

Free reads (`@1.0.5`):

```json
{
  "mcpServers": {
    "secondeye-unblock": {
      "command": "npx",
      "args": ["-y", "@secondeyes/mcp-unblock@1.0.5"],
      "env": { "SECOND_EYE_BASE_URL": "https://secondeyesai.com" }
    }
  }
}
```

Auto-pay x402 (`@1.1.0` — verify `npm view @secondeyes/mcp-unblock version`):

```json
{
  "mcpServers": {
    "secondeye-unblock": {
      "command": "npx",
      "args": ["-y", "@secondeyes/mcp-unblock@1.1.0"],
      "env": {
        "SECOND_EYE_BASE_URL": "https://secondeyesai.com",
        "MCP_X402_WALLET_KEY": "0x…",
        "MCP_X402_MAX_SPEND_USD": "0.50",
        "MCP_X402_SESSION_MAX_USD": "2.00"
      }
    }
  }
}
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| No token / auth | Set `SMITHERY_API_KEY` or `smithery auth login` |
| 405 on scan | Redeploy site — `/api/bar` POST MCP facade missing |
| 403 Forbidden | Cloudflare Bot Fight Mode blocking `SmitheryBot/1.0` — whitelist or use server-card |
| Scan fails | Ensure `/.well-known/mcp/server-card.json` is live |

## MCPB bundle path (alternative)

For local-only stdio without URL:

```bash
smithery mcp publish ./server.mcpb -n @secondeyes/mcp-unblock
```

See Anthropic MCPB spec if building a bundle from this repo.
