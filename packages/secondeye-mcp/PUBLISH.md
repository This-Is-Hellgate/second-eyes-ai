# Publish checklist

**Status (2026-05-26):** npm + MCP Registry live at `@secondeyes/mcp-unblock@1.0.4`.

## 1. npm + MCP Registry (done)

| Target | Value |
|--------|-------|
| npm | `@secondeyes/mcp-unblock@1.0.4` |
| MCP Registry | `io.github.This-Is-Hellgate/secondeye-mcp-unblock` |
| GitHub secret | `NPM_TOKEN` on `This-Is-Hellgate/second-eyes-ai` (packages/secondeye-mcp) |

### Bump + publish

```bash
# bump package.json + server.json version (packages/secondeye-mcp)
git commit -am "chore: bump mcp to X.Y.Z"
git tag mcp-vX.Y.Z
git push origin main --tags
```

GitHub Actions (`.github/workflows/publish-mcp.yml`) publishes npm + MCP Registry on `mcp-v*` tag push.

### Install

```json
{
  "mcpServers": {
    "secondeye-unblock": {
      "command": "npx",
      "args": ["-y", "@secondeyes/mcp-unblock"],
      "env": { "SECOND_EYE_BASE_URL": "https://secondeyesai.com" }
    }
  }
}
```

Or: `npx @secondeyes/mcp-unblock`

---

## 2. Discovery sync (main site)

After npm bump, update and deploy:

- `public/.well-known/mcp.json` → `packages[0].version`
- `public/llms.txt` → MCP install section
- `npx wrangler pages deploy public --project-name=second-eyes-ai`

---

## 3. Independent registries (manual)

Copy-paste from `registry/independent-registries.md` into:

- Glama, Smithery, PulseMCP, mcp.so, Agent.market

---

## 4. AWS Agent Registry (optional)

Requires AWS CLI v2.34.28+, credentials, `AWS_AGENT_REGISTRY_ID`.

```bash
export AWS_AGENT_REGISTRY_ID=your-registry-id
export AWS_REGION=us-east-1
node scripts/publish-aws-registry.mjs
```

Listing text: `registry/aws-agent-registry.md`

---

## 5. Hugging Face Space

Space: https://huggingface.co/spaces/HellGateSys/secondeye-mcp-unblock

```bash
cd hf-space
hf upload HellGateSys/secondeye-mcp-unblock . --repo-type space
```

---

## Security

Rotate `NPM_TOKEN` if exposed in chat. Re-enable npm 2FA for write actions when CI is stable.
