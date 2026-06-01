# Changelog

## [Unreleased]

### Fixed

- **README install paths** — `@1.2.0` is now the recommended autopay install; `@1.0.5` is documented as the free-reads-only fallback. Removed the `@1.1.0` install instruction (1.1.x registers x402 v1 clients that fail production v2 402s) and replaced it with an explicit "do not use 1.1.x" warning.
- **MCP runtime version** — `McpServer` now reports the published package version (read from `package.json`) instead of the hardcoded `1.0.0`, so the advertised version can no longer drift from the tarball.

### Changed

- `scripts/discovery-consistency-check.mjs` now also asserts the package README documents the canonical autopay install, rejects bare `@1.1.x` install instructions, and fails on any hardcoded `McpServer` version that differs from canonical. The `discovery-check` workflow now runs on README and `src/index.js` changes.

## [1.2.0] — 2026-05-30

### Fixed

- **x402 v2 cutover** — MCP auto-pay now uses `ExactEvmScheme`, network `eip155:8453`, `wrapFetchWithPayment` + `x402Client` + `toClientEvmSigner`. Previous 1.1.x releases incorrectly documented v2 while still registering v1 clients (`ExactEvmSchemeV1`, `network: base`), which fail against production 402 (`No client registered for x402 version: 2`).

### Changed

- `priceFrom402` reads v2 `accept.amount` as well as legacy `maxAmountRequired`.
- `walletStatus()` reports `x402_version: 2` and `network: eip155:8453`.

## [1.1.1] — 2026-05-29

### Documentation

- README: pin `@1.0.5` (free reads) vs `@1.1.0` (auto-pay); link HOW TO PAY at https://secondeyesai.com/llms.txt

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
