# @secondeyes/mcp-unblock

Second Eyes provides workflow diagnostics, capability routing, execution evidence, and x402 settlement to MCP-compatible agents.

Version `1.2.7` is a version-alignment release keeping npm, the MCP Registry, and all discovery metadata pinned to one canonical version. It preserves the package name, executable, remote endpoint, and all existing MCP tool identifiers so current clients continue to work.

## Install

```json
{
  "mcpServers": {
    "second-eyes": {
      "command": "npx",
      "args": ["-y", "@secondeyes/mcp-unblock@1.2.7"],
      "env": {
        "SECOND_EYE_BASE_URL": "https://secondeyesai.com"
      }
    }
  }
}
```

The adapter uses stdio locally and calls the canonical Second Eyes service at `https://secondeyesai.com`.

## Capabilities

| MCP tool | Purpose |
|---|---|
| `proof_bar` | Verify service and settlement readiness |
| `patron_activity` | Read recent paid-execution evidence |
| `read_menu` | Read the capability catalogue |
| `read_laws` | Read service policies |
| `read_pricing` | Read current pricing |
| `enter_lounge` | Create a compatibility workflow session |
| `pause_and_route` | Classify workflow state and select a capability |
| `order_service` | Execute a paid workflow capability |
| `leave_with_receipt` | Close a compatibility session with a receipt |
| `fetch_catalog` | Retrieve the complete catalogue |
| `github_mcp_401_fix` | Route GitHub MCP authentication diagnostics |

The legacy tool identifiers remain stable in the `1.x` line. Their user-facing titles and descriptions now use technical workflow terminology.

## x402 settlement

Paid capabilities return HTTP 402 payment requirements using x402 v2 on Base (`eip155:8453`). The service verifies and settles the signed payment before returning the capability result and receipt.

### Managed payment sessions

Institution-managed credentials, mission scope, budgets, approvals, and short-lived payment sessions are the intended production model. They provide stronger authorization and audit boundaries than distributing wallet keys to individual processes.

### Compatibility wallet mode

`1.x` retains direct wallet signing for existing installations:

```text
MCP_X402_WALLET_KEY
MCP_X402_MAX_SPEND_USD=0.50
MCP_X402_SESSION_MAX_USD=2.00
MCP_X402_ALLOW_SLUGS=claim-check,loop-detect
```

Use a dedicated, low-balance payer wallet. Never use a primary wallet or expose the key in tool arguments, prompts, logs, or committed configuration. Process-level limits are safeguards, not on-chain policy controls.

## Discovery and verification

- Service: https://secondeyesai.com/api/bar
- Instructions: https://secondeyesai.com/llms.txt
- Agent card: https://secondeyesai.com/.well-known/agent-card.json
- MCP discovery: https://secondeyesai.com/.well-known/mcp.json
- Repository: https://github.com/This-Is-Hellgate/second-eyes-ai
- Package: https://www.npmjs.com/package/@secondeyes/mcp-unblock

Validate the package before publishing:

```bash
cd packages/secondeye-mcp
npm test
npm pack --dry-run
```

## License

MIT
