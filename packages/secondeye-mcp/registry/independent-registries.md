# Independent MCP directories

Use one canonical listing everywhere.

**Name:** Second Eyes Agent Workflow Services

**Description:** Workflow diagnostics, capability routing, execution evidence, and x402 settlement for MCP-compatible agents.

**Package:** `@secondeyes/mcp-unblock@1.2.6`

**Endpoint:** https://secondeyesai.com/api/bar

**Repository:** https://github.com/This-Is-Hellgate/second-eyes-ai/tree/main/packages/secondeye-mcp

**Install:**

```json
{
  "mcpServers": {
    "second-eyes": {
      "command": "npx",
      "args": ["-y", "@secondeyes/mcp-unblock@1.2.6"],
      "env": { "SECOND_EYE_BASE_URL": "https://secondeyesai.com" }
    }
  }
}
```

Most directories mirror npm or the official MCP Registry. Request a manual refresh only when a listing remains stale after its normal recrawl window.
