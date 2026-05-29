# Changelog

## [1.1.0] — 2026-05-29

### Added

- **MCP-native x402 payment** — `order_service` auto-settles HTTP 402 via `@x402/fetch` when `MCP_X402_WALLET_KEY` is set on the MCP server process (same Base USDC rail as REST canary).
- **`src/x402-wallet.js`** — wallet load, spending caps, slug allow-list, and paid retry helper.
- **Env controls:** `MCP_X402_MAX_SPEND_USD` (default $0.50/call), `MCP_X402_SESSION_MAX_USD` (default $2.00/process), `MCP_X402_ALLOW_SLUGS` (default `should-i-pay` only — fail closed).
- **`npm run test:mcp-pay`** — integration script for MCP payment composition (`scripts/mcp-order-pay-canary.mjs`).

### Security

- Fail-closed slug default: only `should-i-pay` auto-pays unless operator sets `MCP_X402_ALLOW_SLUGS` (or `*` for full menu).
- README wallet warning: dedicated low-balance payer only; never main wallet.

### Dependencies

- `@x402/fetch` ^2.13.0, `@x402/evm` ^2.13.0, `viem` ^2.51.2
