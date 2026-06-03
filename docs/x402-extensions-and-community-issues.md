# x402 v2 extension surface + community issue tracking

This doc maps the repo-side x402 v2 extension work to the relevant upstream
community issues, and records what is implemented vs. what is blocked on an external
dependency (live CDP facilitator behavior, on-chain redemption, gas sponsorship).

## Transports implemented

| Transport | Where | Status |
| --- | --- | --- |
| HTTP (baseline) | `functions/_lib/x402.js`, `functions/_lib/bar-pay.js` | v2 compliant: `x402Version: 2`, `PAYMENT-REQUIRED` header (base64 PaymentRequired), `PAYMENT-SIGNATURE` request header, `PAYMENT-RESPONSE` + `X-PAYMENT-RESPONSE` settlement headers, `eip155:8453` (CAIP-2), resource object `{ url, description, mimeType }`. |
| MCP | `functions/_lib/mcp-facade.js` | Paid `tools/call` uses `_meta["x402/payment"]`. Unpaid → MCP error `-32402` carrying the PaymentRequired object; paid retry settles via the shared CDP verify/settle path and returns the receipt. |
| A2A (JSON-RPC) | `functions/_lib/a4a.js`, `functions/api/a4a.js` | `x402.payment.status` lifecycle metadata (`payment-required` → `payment-submitted` → `payment-completed`/`payment-failed`). `AgentCard.capabilities.extensions` declares x402 in `public/.well-known/agent-card.json`. |

## Extensions (`functions/_lib/x402-extensions.js`)

| Extension | Repo-side | Live | Blocked reason (if any) |
| --- | --- | --- | --- |
| Bazaar metadata (`serviceName`, `tags`, `iconUrl`) | ✅ emitted in 402 + settle extensions | ✅ | — |
| Payment-identifier (`required: true`) + idempotency | ✅ decision logic + D1 idempotency in `bar-pay.js`/`a4a-store.js` | ✅ | — |
| Auth-hints | ✅ metadata | ✅ | — |
| Offer-and-receipt (signed, deterministic) | ✅ HMAC-SHA256 over canonical JSON, verify path | ✅ | — |
| Batch-settlement | ✅ commitment model + accrue/close | ❌ | CDP facilitator settles one authorization per verify/settle; no batch-redeem endpoint. |
| Auth-capture (authorize/capture/void/refund) | ✅ state machine | ❌ | CDP verify/settle captures the full signed amount at settle; no separate hold/capture/void call. |
| EIP-2612 / ERC20 gas sponsorship | ✅ permit typed-data builder + metadata | ❌ | No paymaster/relayer is operated; CDP does not sponsor gas on our behalf. |

The blocked items are blocked **only** at the live on-chain/facilitator boundary.
The commitment model, authorize→capture state machine, and permit typed-data builder
are real and unit-tested (`test/x402-extensions/extensions.test.mjs`).

## Community issues

These are the upstream issues this work connects to. Where Second Eyes cannot fix an
upstream limitation, it still emits the relevant metadata so an indexer/agent that
later gains support gets correct data for free.

- **#2207** — x402 v2 PaymentRequired header shape (`PAYMENT-REQUIRED` base64 +
  resource object). Addressed by `paymentRequiredObject()` / `payment402Headers()` in
  `x402.js`. The header carries a truncated description for proxy-size safety; the full
  description ships in the 402 body and settle echo.
- **#2332** — MCP payment over `_meta["x402/payment"]`. Addressed by
  `handleMcpPaidTool()` in `mcp-facade.js` (error `-32402` on unpaid, settle on retry).
- **#1777** — A2A x402 lifecycle metadata + AgentCard extension declaration.
  Addressed by the `x402.payment.status` states in `a4a.js` and the
  `capabilities.extensions` block in `agent-card.json`.
- **#1375** — Payment-identifier / idempotency to prevent double charge on retry.
  Addressed by `paymentIdentifierExtension()` + `paymentIdentityDecision()` and the
  existing D1 idempotency-key store (`a4a-store.js`, `bar-pay.js`).
- **#1921** — Bazaar discovery metadata (serviceName/tags/iconUrl) on listings.
  Addressed by `bazaarMetadataExtension()`. **Upstream limitation:** the public CDP
  Bazaar indexer currently catalogs the clean accepts[] only and ignores some
  extension fields; we emit the metadata regardless so it is correct the moment the
  indexer reads it (follow-up: re-check indexer coverage of `extensions.bazaar_metadata`).

## Follow-ups

- Re-verify CDP Bazaar indexer coverage of `extensions.bazaar_metadata` (#1921).
- Wire live batch redemption / auth-capture / gas sponsorship if/when the facilitator
  exposes the corresponding calls (batch-settlement, auth-capture, EIP-2612 rows above).
