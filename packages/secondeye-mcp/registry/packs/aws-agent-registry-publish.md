# AWS Agent Registry publish pack

**$1 USDC (x402, Base) — one-time fetch**

```
GET https://secondeyesai.com/api/bar/taps/aws-agent-registry-publish
→ HTTP 402 → pay → retry with PAYMENT-SIGNATURE → full pack JSON
```

Free index: this file (summary). Paid tap returns the complete operational playbook with live Second Eyes reference IDs, troubleshooting matrix, and CLI payloads.

---

## What AWS speaks

Amazon **Bedrock AgentCore Agent Registry** is not generic AWS. It validates records against **official agent protocols**:

| `descriptorType` | Protocol | What you submit |
|------------------|----------|-----------------|
| **MCP** | Model Context Protocol | `server.json` + optional tools JSON |
| **A2A** | Agent-to-Agent | Agent card (schema `0.3`) |
| **AGENT_SKILLS** | Agent Skills | SKILL.md + optional skill definition |
| **CUSTOM** | Anything else | Valid JSON |

**Two CLI services:**

- `bedrock-agentcore-control` — create registry, create/submit/approve records
- `bedrock-agentcore` — search approved records

Docs: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/registry-supported-record-types.html

---

## MCP server descriptor

Based on official MCP Registry `server.json`.

- **Schema versions:** `2025-12-11` (recommended), `2025-10-17`, …
- **`name`:** reverse-DNS, one slash — `io.github.org/server-name`
- **Required:** `name`, `description`, `version`
- **`inlineContent`:** your server object as a **stringified JSON string**

Minimal valid server:

```json
{
  "name": "io.example/weather-server",
  "description": "Weather data and forecasts",
  "version": "1.0.0"
}
```

---

## MCP tools descriptor (optional)

If you include tools, **every tool needs `inputSchema`**. Name + description alone fails validation:

```
Schema validation failed: content is not in compliance with schema version '2024-11-05'
```

```json
{
  "tools": [{
    "name": "get_weather",
    "description": "Get weather for a city",
    "inputSchema": {
      "type": "object",
      "properties": { "city": { "type": "string" } }
    }
  }]
}
```

**Recommendation:** omit tools on first publish; server descriptor alone is enough.

---

## URL synchronization — the 405 trap

CLI flag: `--synchronization-type URL` (not `FROM_URL`).

Config shape:

```json
{ "fromUrl": { "url": "https://..." } }
```

**Critical:** AWS hits that URL as a **live MCP server** (protocol handshake). A static discovery file is not an MCP server.

| URL | Result |
|-----|--------|
| `https://yoursite.com/.well-known/mcp.json` | **CREATE_FAILED** — `MCP server returned HTTP 405` |
| `https://yoursite.com/api/mcp` (live streamable-http MCP) | May work for auto-sync |
| No sync — manual `inlineContent` only | **Works** — recommended first publish |

---

## Publish workflow

1. Install AWS CLI 2.34.28+ (`winget install Amazon.AWSCLI`)
2. `aws configure` — keys, `us-east-1`, `json`
3. Create registry in console → copy **registry ID**
4. Build `server.json` (schema `2025-12-11`)
5. Create record with manual MCP descriptor
6. `submit-registry-record-for-approval`
7. Search with `bedrock-agentcore search-registry-records`

**Record lifecycle:** `CREATING` → `DRAFT` → `PENDING_APPROVAL` → `APPROVED` (or `CREATE_FAILED` — check `statusReason`)

---

## Windows pitfalls

| Problem | Fix |
|---------|-----|
| `\|` in description breaks CLI | Use `shell: false` or `--cli-input-json file://payload.json` |
| `aws configure` pastes prompt text | Use `aws configure set region us-east-1` one field at a time |
| PowerShell eats JSON | Never inline large JSON — use file input |

---

## Second Eyes live reference (verified 2026-05-28)

| Field | Value |
|-------|-------|
| Registry ID | `jaMy0SuApKYYJDTa` |
| Record ID | `nJXn9fAgirGB` |
| Status | **APPROVED** |
| MCP name | `io.github.This-Is-Hellgate/secondeye-mcp-unblock` |
| npm | `@secondeyes/mcp-unblock@1.2.1` (autopay, x402 v2; do not use `@1.1.x`; `@1.0.5` free-reads fallback) |
| HOW TO PAY | https://secondeyesai.com/llms.txt |
| Publish script | `node scripts/publish-aws-registry.mjs` |

Console: https://us-east-1.console.aws.amazon.com/bedrock-agentcore/home?region=us-east-1#/registries/jaMy0SuApKYYJDTa

---

## Automated publish (this repo)

```powershell
$env:AWS_AGENT_REGISTRY_ID = "jaMy0SuApKYYJDTa"
node scripts/publish-aws-registry.mjs
```

Script writes `registry/aws-registry-record.json` and uses `--cli-input-json` (Windows-safe).

---

## Verify before pay

```bash
curl -s https://secondeyesai.com/api/bar/proof | jq .pass   # true
curl -s https://secondeyesai.com/api/bar/catalog | jq '.micro_taps[] | select(.slug=="aws-agent-registry-publish")'
```

---

## Related discovery

- MCP Registry: `io.github.This-Is-Hellgate/secondeye-mcp-unblock`
- npm: `@secondeyes/mcp-unblock`
- Glama, HuggingFace, llms.txt, agent-card.json — see `registry/independent-registries.md`

**Full pack (troubleshooting matrix, CLI heredocs, claims):** `$1 micro tap` above.
