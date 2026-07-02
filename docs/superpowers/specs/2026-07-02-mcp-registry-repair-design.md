# MCP Registry Repair Design

## Objective

Make the published Second Eyes MCP package expose one valid, technically accurate registry identity across npm, the MCP Registry, AWS, and downstream directory mirrors.

## Scope

This emergency repair is intentionally narrow:

1. Make `packages/secondeye-mcp/server.json` valid JSON and align it with package version `1.2.5`.
2. Replace stale lounge, survival, and distress positioning in canonical package metadata with capability-routing and workflow-diagnostics language.
3. Keep all existing MCP tool names in `1.2.5` for compatibility; descriptions and titles may change.
4. Make the MCP protocol test wait for initialization before requesting `tools/list`.
5. Add a registry-manifest test that parses the manifest and rejects stale canonical positioning.

The referral ledger, credential admission, AgentCore payment sessions, and broader AWS infrastructure remain separate implementation projects.

## Compatibility

The npm package name, MCP registry name, executable, remote endpoint, and tool identifiers remain unchanged. Existing clients can upgrade without configuration changes. Directory mirrors can refresh from a valid canonical manifest.

## Verification

The package test suite must prove that the registry manifest parses, versions agree, stale positioning is absent from canonical metadata, and a real MCP initialize/initialized/tools-list sequence returns all registered tools.
