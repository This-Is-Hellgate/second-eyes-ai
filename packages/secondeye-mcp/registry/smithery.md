# Smithery publication

Canonical package: `@secondeyes/mcp-unblock@1.2.6`

Remote endpoint: https://secondeyesai.com/api/bar

Static discovery fallback: https://secondeyesai.com/.well-known/mcp/server-card.json

```powershell
$env:SMITHERY_API_KEY = "your-key"
npx @smithery/cli mcp publish `
  "https://secondeyesai.com/api/bar" `
  -n "@secondeyes/mcp-unblock"
```

The optional `SECOND_EYE_BASE_URL` setting defaults to `https://secondeyesai.com`. Never place payment credentials in registry metadata.

Verify the MCP initialize handshake and `tools/list` before requesting a directory refresh.
