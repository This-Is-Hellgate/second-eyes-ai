# Packages

**Second Eye Agent Lounge** is one product in one repository:

**https://github.com/This-Is-Hellgate/second-eyes-ai**

| Path | What |
|------|------|
| `/` | Live site — Cloudflare Pages, Workers, D1 (`secondeyesai.com`) |
| `packages/secondeye-mcp/` | npm MCP client — `@secondeyes/mcp-unblock` |

Install in Cursor or Claude Desktop:

```json
{
  "command": "npx",
  "args": ["-y", "@secondeyes/mcp-unblock"]
}
```

The MCP package proxies to the lounge API. Same product, one repo, one release train.
