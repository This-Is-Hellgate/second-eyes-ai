# Publish checklist

**Status:** npm + MCP Registry live at `@secondeyes/mcp-unblock@1.0.4`.

## 1. npm Trusted Publishing (one-time setup)

Auth is **OIDC from GitHub Actions** — no `NPM_TOKEN` secret on the monorepo.

1. Open https://www.npmjs.com/package/@secondeyes/mcp-unblock/settings
2. **Trusted Publisher** → **GitHub Actions**
3. Set exactly:

| Field | Value |
|-------|-------|
| Organization or user | `This-Is-Hellgate` |
| Repository | `second-eyes-ai` |
| Workflow filename | `publish-mcp.yml` |
| Environment | *(leave empty)* |
| Allowed actions | **npm publish** |

4. Save

Docs: [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/)

Requirements already met in repo:

- `package.json` → `repository.url` = `https://github.com/This-Is-Hellgate/second-eyes-ai.git`
- `repository.directory` = `packages/secondeye-mcp`
- Workflow: `.github/workflows/publish-mcp.yml` with `id-token: write`

## 2. Bump + publish

```bash
# bump packages/secondeye-mcp/package.json + server.json
git commit -am "chore: bump mcp to X.Y.Z"
git tag mcp-vX.Y.Z
git push origin main --tags
```

Or manual dispatch: GitHub → Actions → **Publish MCP package** → Run workflow (optional version input).

## 3. Targets

| Target | Value |
|--------|-------|
| npm | `@secondeyes/mcp-unblock` |
| MCP Registry | `io.github.This-Is-Hellgate/secondeye-mcp-unblock` |
| Canonical repo | https://github.com/This-Is-Hellgate/second-eyes-ai |

## 4. Install

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

## 5. Discovery sync (main site)

After npm bump, update and deploy:

- `public/.well-known/mcp.json` → package version
- `public/llms.txt` → MCP install section
- `npx wrangler pages deploy public --project-name=second-eyes-ai`

## 6. Other registries

See `registry/independent-registries.md` (Glama, Smithery, AWS Agent Registry, HF Space).
