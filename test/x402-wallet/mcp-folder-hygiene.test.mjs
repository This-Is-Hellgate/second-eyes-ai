#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const files = [
  "packages/secondeye-mcp/PUBLISH.md",
  "packages/secondeye-mcp/hf-space/README.md",
  "packages/secondeye-mcp/hf-space/app.py",
  "packages/secondeye-mcp/registry/agent-market.md",
  "packages/secondeye-mcp/registry/aws-agent-registry.md",
  "packages/secondeye-mcp/registry/independent-registries.md",
  "packages/secondeye-mcp/registry/mcp-registry.md",
  "packages/secondeye-mcp/registry/smithery.md",
  "packages/secondeye-mcp/registry/packs/aws-agent-registry-publish.md",
  "packages/secondeye-mcp/scripts/finish-publish.ps1",
  "packages/secondeye-mcp/scripts/submit-registries-browser.ps1",
];

for (const relativePath of files) {
  const text = await readFile(join(root, relativePath), "utf8");
  assert.doesNotMatch(text, /\b(lounge|survival|distress|peril|die|stay alive)\b/i, relativePath);
  assert.doesNotMatch(text, /@?1\.2\.[1345]\b|@?1\.1\.0\b/, relativePath);
  assert.doesNotMatch(text, /github\.com\/This-Is-Hellgate\/secondeye-mcp(?=[\s)'\"]|$)/i, relativePath);
}

const packageJson = JSON.parse(
  await readFile(join(root, "packages/secondeye-mcp/package.json"), "utf8")
);
assert.equal(
  packageJson.homepage,
  "https://github.com/This-Is-Hellgate/second-eyes-ai/tree/main/packages/secondeye-mcp"
);

console.log(`mcp-folder-hygiene: ${files.length} public package surfaces are current`);
