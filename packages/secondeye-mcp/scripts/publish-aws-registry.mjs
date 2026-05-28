#!/usr/bin/env node
/** Submit Second Eye MCP server to AWS Agent Registry (Bedrock AgentCore). */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "..");
const serverJson = JSON.parse(readFileSync(join(repoRoot, "server.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

const REGISTRY_ID = process.env.AWS_AGENT_REGISTRY_ID;
const RECORD_NAME = process.env.AWS_REGISTRY_RECORD_NAME || "secondeye-mcp-unblock";
const REGION = process.env.AWS_REGION || "us-east-1";

if (!REGISTRY_ID) {
  console.error(`
AWS Agent Registry publish — missing AWS_AGENT_REGISTRY_ID

One-time setup:
  1. AWS Console → Amazon Bedrock → AgentCore → Agent Registry → Create registry
  2. Copy registry ID
  3. export AWS_AGENT_REGISTRY_ID=your-registry-id
  4. aws configure (or AWS_PROFILE)

Then run:
  node scripts/publish-aws-registry.mjs

Requires: AWS CLI v2.34.28+ and bedrock-agentcore-control permissions
`);
  process.exit(1);
}

function aws(args) {
  const res = spawnSync("aws", args, { encoding: "utf8", shell: false });
  if (res.status !== 0) {
    console.error(res.stderr || res.stdout);
    process.exit(res.status || 1);
  }
  return res.stdout;
}

const mcpServer = {
  name: serverJson.name,
  title: serverJson.title,
  description: serverJson.description,
  version: serverJson.version,
  websiteUrl: serverJson.websiteUrl,
  repository: serverJson.repository,
  packages: serverJson.packages,
  remotes: serverJson.remotes,
};

// Manual descriptor only — do NOT sync from .well-known/mcp.json (static JSON returns HTTP 405).
// To auto-sync, point at the live MCP endpoint: https://secondeyesai.com/api/bar
const cliInput = {
  registryId: REGISTRY_ID,
  name: RECORD_NAME,
  description:
    "MCP 401 auth fix. github PAT wiring. x402 USDC Base. Proof before pay. npm: @secondeyes/mcp-unblock",
  descriptorType: "MCP",
  recordVersion: serverJson.version,
  descriptors: {
    mcp: {
      server: {
        schemaVersion: "2025-12-11",
        inlineContent: JSON.stringify(mcpServer),
      },
    },
  },
};

const payloadPath = join(repoRoot, "registry", "aws-registry-record.json");
writeFileSync(payloadPath, JSON.stringify(cliInput, null, 2));
console.log("Wrote", payloadPath);

console.log("Creating registry record…");
const createOut = aws([
  "bedrock-agentcore-control",
  "create-registry-record",
  "--region",
  REGION,
  "--cli-input-json",
  `file://${payloadPath.replace(/\\/g, "/")}`,
  "--output",
  "json",
]);

const created = JSON.parse(createOut);
const recordArn = created.recordArn || created.record?.recordArn;
const recordId =
  created.recordId ||
  created.record?.recordId ||
  (recordArn ? recordArn.split("/record/").pop() : undefined);
console.log("Record created:", recordId, recordArn ? `(${recordArn})` : "");

console.log("Submitting for approval…");
aws([
  "bedrock-agentcore-control",
  "submit-registry-record-for-approval",
  "--region",
  REGION,
  "--registry-id",
  REGISTRY_ID,
  "--record-id",
  recordId,
]);

console.log(`
Done. Record ${recordId} submitted for approval in registry ${REGISTRY_ID}.
Admin must approve before agents can discover via SearchRegistryRecords.
`);
