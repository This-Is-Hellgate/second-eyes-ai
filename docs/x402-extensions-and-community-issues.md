# x402 v2 extension surface + community issue tracking

This doc maps the repo-side x402 v2 extension work to the relevant upstream
community issues, and records what is implemented vs. what is blocked on an external
dependency (live CDP facilitator behavior, on-chain redemption, gas sponsorship).

## Integration path: Coinbase AgentKit Python x402 action provider

Second Eyes integrates with agents **through Coinbase's official, generic x402 action
provider** — no Second-Eyes-specific client code is required. The provider lives at
`coinbase/agentkit` →
`python/coinbase-agentkit/coinbase_agentkit/action_providers/x402`
(`x402_action_provider`). An agent registers the Second Eyes service URL and calls
`make_http_request` / `retry_http_request_with_x402`; the provider drives the whole
flow off the standard x402 v2 HTTP surface Second Eyes already emits.

What the provider reads, and where Second Eyes produces it:

| Provider step (`x402_action_provider.py`) | Reads | Second Eyes source |
| --- | --- | --- |
| `make_http_request` 402 branch | `response.headers.get("payment-required")` → base64 → JSON `accepts[]` | `payment402Headers()` → `PAYMENT-REQUIRED` (`x402.js`) |
| `filter_usdc_payment_options` / `filter_by_max_price` | `opt["asset"]` == Base USDC, `opt["network"]` CAIP-2, `opt["amount"]` atomic | `buildAcceptEntry()` (`x402-networks.js`) |
| discoveryInfo extraction | top-level `description`, `mimeType`, `extensions` on the decoded header | `paymentRequiredObject()` top-level fields + compact `headerExtensions` (`x402.js`) |
| `retry_with_x402` success | `response.headers.get("payment-response")` or `"x-payment-response"` → base64 JSON | `paymentResponseHeaders()` (`x402.js`) |

Verified end-to-end (header decode, USDC/CAIP filter, discoveryInfo, paid-response
parse) by `test/x402-extensions/coinbase-python-compat.test.mjs`, which mirrors the
exact extraction logic of the Python provider.

## Transports implemented

| Transport | Where | Status |
| --- | --- | --- |
| HTTP (baseline) | `functions/_lib/x402.js`, `functions/_lib/bar-pay.js` | v2 compliant: `x402Version: 2`, `PAYMENT-REQUIRED` header (base64 PaymentRequired with top-level `description`/`mimeType`/compact `extensions` for Coinbase Python discoveryInfo), `PAYMENT-SIGNATURE` request header, `PAYMENT-RESPONSE` + `X-PAYMENT-RESPONSE` settlement headers, `eip155:8453` (CAIP-2), resource object `{ url, description, mimeType }`. |
| MCP | `functions/_lib/mcp-facade.js` | Paid `tools/call` uses `_meta["x402/payment"]`. Unpaid → MCP error `-32402` carrying the PaymentRequired object; paid retry settles via the shared CDP verify/settle path and returns the receipt. |
| A2A (JSON-RPC) | `functions/_lib/a4a.js`, `functions/api/a4a.js` | `x402.payment.status` lifecycle metadata (`payment-required` → `payment-submitted` → `payment-completed`/`payment-failed`). `AgentCard.capabilities.extensions` declares x402 in `public/.well-known/agent-card.json`. |

## Extensions (`functions/_lib/x402-extensions.js`)

| Extension | Repo-side | Live | Blocked reason (if any) |
| --- | --- | --- | --- |
| Bazaar metadata (`serviceName`, `tags`, `iconUrl`) | ✅ emitted in 402 + settle extensions | ✅ | — |
| Payment-identifier (`required: true`) + idempotency | ✅ decision logic + D1 idempotency in `bar-pay.js`/`a4a-store.js` | ✅ | — |
| Auth-hints | ✅ metadata | ✅ | — |
| Offer-and-receipt (signed, deterministic) | ✅ HMAC-SHA256 over canonical JSON, verify path | ✅ | — |
| Batch-settlement | metadata only (no custom shim) | ❌ NOT live | **Not part of the Coinbase Python generic-provider compatibility path.** Official x402 batch-settlement is the upstream direction; the CDP facilitator we settle through exposes one authorization per verify/settle and no batch-redeem endpoint. Second Eyes advertises the extension metadata but does **not** fake a live batch rail. |
| Auth-capture (authorize/capture/void/refund) | metadata only (no custom shim) | ❌ NOT live (server/facilitator) | **Not server/facilitator-supported yet:** official x402 auth-capture currently ships **client-side only**, and the CDP verify/settle path captures the full signed amount at settle with no separate hold/capture/void call. Second Eyes does **not** implement a custom auth-capture server. |
| EIP-2612 / ERC20 gas sponsorship | permit typed-data builder + metadata | ❌ NOT live | No paymaster/relayer is operated; CDP does not sponsor gas on our behalf. |

The blocked items are blocked **only** at the live on-chain/facilitator boundary, and
**none is on the Coinbase Python generic x402 provider compatibility path** — that path
is the HTTP v2 surface in the table above (PAYMENT-REQUIRED / accepts[] / PAYMENT-RESPONSE).
The metadata + permit typed-data builder that are emitted are real and unit-tested
(`test/x402-extensions/extensions.test.mjs`); no custom live shim is faked for batch or
auth-capture.

## Community issues

These are the upstream issues this work connects to. Where Second Eyes cannot fix an
upstream limitation, it still emits the relevant metadata so an indexer/agent that
later gains support gets correct data for free.

- **#2207** — x402 v2 PaymentRequired header shape (`PAYMENT-REQUIRED` base64 +
  resource object). Addressed by `paymentRequiredObject()` / `payment402Headers()` in
  `x402.js`. The header carries a truncated description for proxy-size safety plus
  top-level `description`/`mimeType` and a compact `extensions` block so the Coinbase
  Python provider's discoveryInfo extraction works; the full description + full Bazaar
  schema ship in the 402 body and settle echo. Header size is gated < 8KB
  (`scripts/x402-header-size-selftest.mjs`).
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
