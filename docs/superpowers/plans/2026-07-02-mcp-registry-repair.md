# MCP Registry Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a valid and consistent Second Eyes MCP registry identity without breaking existing client configurations or tool names.

**Architecture:** Treat `package.json`, `server.json`, and the package README as the canonical distribution surface. Add an executable contract test for manifest validity and make the existing MCP round-trip test follow the protocol lifecycle rather than fixed timing.

**Tech Stack:** Node.js ESM, Model Context Protocol SDK, npm package metadata, Node assertion scripts.

---

### Task 1: Registry manifest contract

**Files:**
- Create: `test/x402-wallet/registry-manifest.test.mjs`
- Modify: `packages/secondeye-mcp/package.json`
- Modify: `packages/secondeye-mcp/server.json`

- [ ] Write a failing test that parses `server.json`, compares manifest and package versions, requires the canonical endpoint and registry name, and rejects lounge/survival language.
- [ ] Run `node test/x402-wallet/registry-manifest.test.mjs` and confirm it fails on invalid JSON.
- [ ] Repair the manifest, update canonical metadata, and bump the package to `1.2.5`.
- [ ] Add the contract test to the package `test` script and confirm it passes.

### Task 2: MCP lifecycle test

**Files:**
- Modify: `test/x402-wallet/tool-metadata.test.mjs`

- [ ] Replace fixed delays with response-driven initialization.
- [ ] Send `notifications/initialized` after receiving the initialize result, then request `tools/list`.
- [ ] Run the test and confirm all registered tools are returned.

### Task 3: Canonical package language

**Files:**
- Modify: `packages/secondeye-mcp/README.md`
- Modify: `packages/secondeye-mcp/src/index.js`

- [ ] Replace canonical product positioning and tool descriptions with technical workflow language while preserving tool identifiers.
- [ ] State that direct private-key autopay is a compatibility mode and institution-managed payment sessions are the intended direction.
- [ ] Run `npm test` from `packages/secondeye-mcp`.
- [ ] Run `npm pack --dry-run` and inspect the published file list.

### Task 4: Delivery

**Files:**
- Modify: `packages/secondeye-mcp/CHANGELOG.md`

- [ ] Document the registry repair and compatibility guarantees.
- [ ] Run the complete package tests once more.
- [ ] Commit the focused repair and push the branch for review.
