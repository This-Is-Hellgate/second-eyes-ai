# x402 verify-failure recovery

When an x402 payment fails to verify or settle, the *why* must be recoverable
**without** the Cloudflare dashboard — Cloudflare Pages Functions logs are not
persisted, which is why request `req_ebefc6f9596f2313`'s `invalidReason` was
unrecoverable after the fact.

Every failed verify/settle attempt now persists a redacted detail row in the D1
table `x402_verify_failures`, keyed by the Cloudflare request id (`cf-ray`). That
row is enough to diagnose the failure offline.

## What is captured

One row per failed attempt (`functions/_lib/x402-payment-log.js`):

| Column | Meaning |
| --- | --- |
| `request_id` | Cloudflare `cf-ray` of the request (the recoverable id) |
| `created_at` | ISO timestamp |
| `route` | request path (e.g. `/api/access/purchase`) |
| `stage` | `parse` \| `select` \| `auth` \| `verify` \| `settle` |
| `declared_network` | rail the buyer signed for (multi-rail hard-reject) |
| `selected_network` | rail actually matched/verified |
| `facilitator_status` | CDP `/verify` HTTP status |
| `invalid_reason` | CDP `invalidReason` (or the error string) |
| `facilitator_body` | **redacted** CDP body — signatures/authorizations stripped |
| `x402_version` | x402 protocol version |

`facilitator_body` is run through `redactFacilitatorBody()` **before** it is
persisted: keys matching `signature|authorization|secret|privatekey|private_key|seed|mnemonic`
and any nested object become `[redacted]`, and long strings are bounded. No
signature or private material is ever written to D1.

The table is created lazily on first write (`CREATE TABLE IF NOT EXISTS`), so no
remote migration is required — it self-heals like `x402_payment_attempts`. To
apply it deliberately, dispatch the `D1 migrate` workflow with
`seeds/x402-verify-failures.sql`.

## Look it up — CLI (script-only, no auth surface)

The request id is the `cf-ray` value (visible in the response headers and the CDN
edge logs). Query D1 directly:

```bash
node scripts/x402-failure-lookup.mjs req_ebefc6f9596f2313 --remote
```

- Omit `--remote` to query the local dev DB.
- `--limit N` caps rows (default 20).
- Output is JSON; `facilitator_body` is the already-redacted object.

Requires the same `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` that
`wrangler d1` uses elsewhere.

## Look it up — HTTP (operator-gated)

`GET /api/bar/proof/verify-failure` returns the same data but requires the
`REVIEW_TOKEN` (the existing review-API token), so the diagnostic detail is never
public:

```bash
curl -s "https://secondeyesai.com/api/bar/proof/verify-failure?requestId=req_ebefc6f9596f2313" \
  -H "Authorization: Bearer $REVIEW_TOKEN" | jq
```

The token may also be passed as `?token=$REVIEW_TOKEN`. A missing/wrong token
returns `401`; a missing `REVIEW_TOKEN` binding returns `503`.

## Tests

- `node scripts/x402-failure-recovery-selftest.mjs` — no network/DB; proves
  `readRequestId()` prefers `cf-ray`, `buildVerifyFailureRow()` strips secrets,
  and `recordX402VerifyFailure()` → `lookupX402VerifyFailure()` round-trips
  through an in-memory D1 stub without leaking signature material.
- `node scripts/x402-verify-logging-selftest.mjs` — redaction + the folded
  `failure_reason` string on `x402_payment_attempts`.
