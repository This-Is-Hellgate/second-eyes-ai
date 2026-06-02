# Changelog

## [1.2.1] — 2026-06-02

### Changed

- **Recommended autopay version → 1.2.1** — aligned every buyer-facing surface (README, `server.json`, static `/.well-known/mcp.json`, `server-card.json`, `agent-card.json`, `llms.txt`, and the live API root constant `MCP_AUTOPAY_NPM_VERSION`) to recommend and pin `@1.2.1`. `@1.0.5` remains the legacy free-reads fallback; `@1.1.x` remains a do-not-use warning. No code/API change from 1.2.0 — this release exists to keep the published npm README and discovery metadata consistent for first external buyers.

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
