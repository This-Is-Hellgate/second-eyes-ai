# AWS Agent Registry — listing + store pack

## Live record (verified 2026-05-28)

| Field | Value |
|-------|-------|
| Registry ID | `jaMy0SuApKYYJDTa` |
| Record ID | `nJXn9fAgirGB` |
| Status | **APPROVED** |
| Name | `secondeye-mcp-unblock` |
| Version | `1.2.1` |
| MCP name | `io.github.This-Is-Hellgate/secondeye-mcp-unblock` |

> Current autopay release: `@secondeyes/mcp-unblock@1.2.1` (x402 **v2**: `ExactEvmScheme`, network `eip155:8453`). **Do not use `@1.1.x`** — those builds register x402 v1 clients and fail production 402s. `@1.0.5` remains a free-reads-only fallback. Update the registry record version on next resubmit.

Console: https://us-east-1.console.aws.amazon.com/bedrock-agentcore/home?region=us-east-1#/registries/jaMy0SuApKYYJDTa

---

## Store — full publish playbook ($1)

Agents publishing their own MCP to AWS should buy the operational pack first:

```
GET https://secondeyesai.com/api/bar/taps/aws-agent-registry-publish
→ HTTP 402 → x402 USDC Base ($1) → full JSON playbook
```

Summary (free): `registry/packs/aws-agent-registry-publish.md`  
Automated publish: `node scripts/publish-aws-registry.mjs` (requires `AWS_AGENT_REGISTRY_ID`)

---

## Console listing copy

**Title:** MCP 401 Auth Fix | github-mcp PAT Wiring | x402 USDC Base

**Description:**
Stuck on MCP integration failure? github-mcp 401 unauthorized, PAT scope errors, cursor MCP stdio/SSE transport misconfiguration. Second Eye routes your error state to the right survival service with deterministic pricing. Proof before pay: GET https://secondeyesai.com/api/bar/proof (pass must be true). First 15 minutes session time free. x402 USDC on Base. Leave with verifiable receipt.

**Endpoint URL:** https://secondeyesai.com/api/bar

**MCP server repo:** https://github.com/This-Is-Hellgate/second-eyes-ai/tree/main/packages/secondeye-mcp

**Tags:** mcp, github-mcp, cursor-mcp, 401, 403, PAT, authentication, wiring, x402, usdc, base, agent, infrastructure, proof, receipt, aws, agent-registry

**Category:** Infrastructure / Developer Tools

**Trust snapshot:**
1. GET /api/bar/laws
2. GET /api/bar/pricing
3. GET /api/bar/proof
4. GET /api/bar/triage
5. GET /api/bar/enter

---

## Key lessons (why the pack exists)

- AWS speaks **MCP / A2A / AgentSkills / CUSTOM** — not generic AWS APIs
- MCP tools need **`inputSchema`** or omit tools entirely
- URL sync hits a **live MCP endpoint**, not `.well-known/mcp.json` (405)
- Windows: use **`--cli-input-json file://...`**, never pipe `|` through shell
