# Changelog

## [1.2.3] — 2026-06-02

### Fixed

- **Autopay no longer dead-ends on input-requiring doors (Codex C-025)** — `transcribe-extract` and `doc-extract` need a caller-supplied input (`url`, `doc_type`) that the zero-argument `order_service` tool cannot pass, so a blind paid retry reached the door and rejected with `no_input` (no paid 200, though no funds were lost — the door validates input before settle). They are now **excluded from the zero-argument autopay default-allow set** while staying priced and routable: `order_service` still resolves their session-less x402 path, and an operator can name them in `MCP_X402_ALLOW_SLUGS` to opt in once the input can be supplied out-of-band. New exports `INPUT_REQUIRED_SLUGS` and `ZERO_ARG_AUTOPAY_SLUGS`; `parseAllowSlugs()` default and `*` now resolve to `ZERO_ARG_AUTOPAY_SLUGS` (catalog minus the input-requiring doors). `order_service` advertises the zero-arg set and directs callers to `/api/bar/x402/transcribe` and `/api/bar/x402/extract` for the two excluded doors. Preserves the C-019/C-020 session-less routing from 1.2.x.

## [1.2.2] — 2026-06-02

### Fixed

- **Autopay default unblocked** — with a wallet set and `MCP_X402_ALLOW_SLUGS` unset, autopay now covers **every launch-priced session-less x402/nano slug** (each ≤ $0.05 USDC) instead of `should-i-pay` only. Wallet-configured agents stopped getting `slug_not_allowed` on `claim-check`, `mcp-wiring`, `context-compress`, etc. `MCP_X402_ALLOW_SLUGS` is now a **restrict** list; `*` is equivalent to unset. The safety boundary is the per-call/session caps + the $0.05 catalog price ceiling, not the allow-list.
- **Price catalog synced to launch prices** — `LOUNGE_SERVICE_PRICES_USD` was stale at $0.10–$0.50 while the live 402 quotes and the advertised catalog were $0.01–$0.05, so `guardPayment` could reject valid quotes as `price_mismatch`. The table now mirrors the canonical `functions/_lib/lounge/constants.js` service catalog and adds the session-less x402 nano twins (`help-me` $0.01, `schema-repair` $0.03, `transcribe-extract` $0.05, `doc-extract` $0.05).

### Added

- **Tool annotations + outputSchema** — all tools migrated from the legacy 4-arg `server.tool(...)` to `server.registerTool(...)`. Read tools (`proof_bar`, `patron_activity`, `read_menu`, `read_laws`, `read_pricing`, `fetch_catalog`) carry `readOnlyHint:true` so trusted clients auto-approve the proof→pay funnel; `order_service` / `github_mcp_401_fix` carry `idempotentHint:false, openWorldHint:true` and declare their USDC cost. Every tool now ships an `outputSchema` and a `structuredContent` envelope.
- **Machine-actionable descriptions** — `order_service` encodes the full happy path (proof → enter → order), the price ($0.01–$0.05, max $0.05), autopay behavior, and the allowed-slug list, so an agent reading `tools/list` cold can complete a paid call without external docs.
- **`walletStatus().catalog_max_usd`** + exported `SURVIVAL_PRICE_MAX_USD`.

### Notes

- `@1.1.x` remains a **do-not-use** warning (x402 v1 — fails production v2 402s). `@1.0.5` remains the legacy free-reads-only fallback. `@1.2.x` is current.

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

- Fail-closed slug default: only `should-i-pay` auto-pays unless operator sets `MCP_X402_ALLOW_SLUGS` (or `*` for the full catalog).
- README wallet warning: dedicated low-balance payer only; never main wallet.

### Dependencies

- `@x402/fetch` ^2.13.0, `@x402/evm` ^2.13.0, `viem` ^2.51.2
