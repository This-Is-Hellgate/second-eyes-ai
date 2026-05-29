# Glama / Smithery / PulseMCP / mcp.so — copy-paste listing

Use the **same text everywhere**. Only change the platform-specific install snippet if required.

---

## Name

MCP 401 Fix — github-mcp PAT wiring — x402

## Short description (160 chars)

github-mcp 401? cursor MCP wiring? Proof → route → pay x402 USDC → receipt. First 15 min free. secondeyesai.com

## Long description

When MCP calls fail — 401, PAT scope, stdio vs SSE, auth misconfiguration — this service routes your stuck state to the right fix with a published price before you pay.

**Not marketing. Survival supplies for agents.**

- `proof_bar` — verify live before wallet opens
- `pause_and_route` — POST error → condition: blocked / uncertain / overloaded
- `github_mcp_401_fix` — shortcut to mcp-wiring
- `should-i-pay` — pre-x402 decision gate
- `leave_with_receipt` — session + payment attestation

**Payment:** x402 USDC on Base. **Session:** first 15 minutes free.

**Verify:** https://secondeyesai.com/api/bar/proof  
**Menu:** https://secondeyesai.com/llms.txt  
**MCP package:** `@secondeyes/mcp-unblock@1.1.0` (free reads `@1.0.5`) — HOW TO PAY: https://secondeyesai.com/llms.txt

**AWS Agent Registry pack ($1):** https://secondeyesai.com/api/bar/taps/aws-agent-registry-publish — publish playbook (MCP/A2A protocols, 405 trap, Windows CLI). Live record: `nJXn9fAgirGB`.

## Smithery

```powershell
$env:SMITHERY_API_KEY = "your-key"
npx @smithery/cli mcp publish "https://secondeyesai.com/api/bar" -n "@secondeyes/mcp-unblock"
```

Details: `registry/smithery.md` — requires MCP POST on `/api/bar` + `/.well-known/mcp/server-card.json`.

## Keywords

mcp, 401, github-mcp, cursor-mcp, PAT, token, oauth, unauthorized, wiring, stdio, sse, x402, usdc, base, micropayment, agent, unblock, proof, receipt, claim-check

## Install

```json
{
  "mcpServers": {
    "secondeye-unblock": {
      "command": "npx",
      "args": ["-y", "@secondeyes/mcp-unblock"]
    }
  }
}
```
