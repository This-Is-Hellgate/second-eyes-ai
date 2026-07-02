# MCP release procedure

Release candidate: `@secondeyes/mcp-unblock@1.2.6`.

## Canonical release path

1. Update `package.json`, `package-lock.json`, `server.json`, the AWS descriptor, and public discovery metadata to the same version.
2. Run `npm test` and `npm pack --dry-run` from this directory.
3. Merge the verified change to `main`.
4. Run the `Publish MCP package` GitHub Actions workflow with the version input.

The workflow uses npm Trusted Publishing through GitHub OIDC and publishes to the official MCP Registry. Do not add a long-lived npm token to the repository.

## Required identifiers

| Target | Identifier |
|---|---|
| npm | `@secondeyes/mcp-unblock` |
| MCP Registry | `io.github.This-Is-Hellgate/secondeye-mcp-unblock` |
| AWS Agent Registry | registry `jaMy0SuApKYYJDTa`, record `nJXn9fAgirGB` |

After publication, verify npm and the official MCP Registry directly, then update the approved AWS record and allow downstream directories time to recrawl.
