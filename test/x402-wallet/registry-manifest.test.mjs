#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const packageJson = JSON.parse(await readFile(join(root, "packages/secondeye-mcp/package.json"), "utf8"));
const manifestText = await readFile(join(root, "packages/secondeye-mcp/server.json"), "utf8");
const manifest = JSON.parse(manifestText);
const awsRecord = JSON.parse(
  await readFile(join(root, "packages/secondeye-mcp/registry/aws-registry-record.json"), "utf8")
);
const awsManifest = JSON.parse(awsRecord.descriptors.mcp.server.inlineContent);

assert.equal(manifest.name, "io.github.This-Is-Hellgate/secondeye-mcp-unblock");
assert.equal(manifest.version, packageJson.version);
assert.equal(manifest.packages[0].version, packageJson.version);
assert.equal(manifest.remotes[0].url, "https://secondeyesai.com/api/bar");
assert.equal(awsRecord.recordVersion, packageJson.version);
assert.equal(awsManifest.version, packageJson.version);
assert.equal(awsManifest.packages[0].version, packageJson.version);

const canonicalMetadata = [
  packageJson.description,
  ...(packageJson.keywords || []),
  manifest.title,
  manifest.description,
  ...manifest.packages.flatMap((entry) =>
    (entry.environmentVariables || []).flatMap((variable) => [variable.name, variable.description])
  ),
  awsRecord.description,
  awsManifest.title,
  awsManifest.description,
  ...awsManifest.packages.flatMap((entry) =>
    (entry.environmentVariables || []).flatMap((variable) => [variable.name, variable.description])
  ),
].join(" ");

assert.doesNotMatch(canonicalMetadata, /\b(lounge|survival|distress|peril|die|stay alive)\b/i);
assert.match(canonicalMetadata, /workflow/i);
assert.match(canonicalMetadata, /x402/i);

console.log("registry-manifest: valid, version-aligned, and technically positioned");
