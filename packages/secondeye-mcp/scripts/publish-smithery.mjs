#!/usr/bin/env node
/** Publish Second Eye MCP to Smithery registry. Requires SMITHERY_API_KEY or smithery auth login. */
import { spawnSync } from "node:child_process";

const URL = process.env.SMITHERY_MCP_URL || "https://secondeyesai.com/api/bar";
const NAME = process.env.SMITHERY_SERVER_NAME || "@secondeyes/mcp-unblock";
const CONFIG_SCHEMA = process.env.SMITHERY_CONFIG_SCHEMA;

if (!process.env.SMITHERY_API_KEY) {
  const whoami = spawnSync("npx", ["@smithery/cli", "auth", "whoami"], { encoding: "utf8", shell: true });
  if (whoami.status !== 0) {
    console.error(`
Smithery publish — missing SMITHERY_API_KEY

  1. https://smithery.ai → Settings → API Keys
  2. $env:SMITHERY_API_KEY = "your-key"
  3. node scripts/publish-smithery.mjs

Or: npx @smithery/cli auth login
`);
    process.exit(1);
  }
}

const args = ["@smithery/cli", "mcp", "publish", URL, "-n", NAME];
if (CONFIG_SCHEMA) {
  args.push("--config-schema", CONFIG_SCHEMA);
}

console.log("Publishing to Smithery:", NAME, "→", URL);
const res = spawnSync("npx", args, { encoding: "utf8", stdio: "inherit", shell: false });
process.exit(res.status ?? 1);
