# Official MCP Registry

Canonical name: `io.github.This-Is-Hellgate/secondeye-mcp-unblock`

Release candidate: `1.2.6`

Publication is handled by `.github/workflows/publish-mcp.yml` after npm Trusted Publishing succeeds. The workflow authenticates with GitHub OIDC, validates `server.json`, and publishes the immutable version record.

Verify directly:

```text
https://registry.modelcontextprotocol.io/v0.1/servers/io.github.This-Is-Hellgate%2Fsecondeye-mcp-unblock/versions/latest
```

Every new metadata publication requires a unique version aligned with the npm package.
