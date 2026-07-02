#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const spec = await readFile(join(root, "SPEC.md"), "utf8");

for (const requirement of [
  /trusted institution registry/i,
  /credentialed agent/i,
  /active mission mandate/i,
  /scoped capability profile/i,
  /payment alone never grants operational authority/i,
  /owner-visible/i,
]) {
  assert.match(spec, requirement);
}

assert.doesNotMatch(spec, /open-to-everyone|no allowlist|low-trust agent|seed phrases/i);

console.log("spec-authority: cascading institutional and mission authority is canonical");
