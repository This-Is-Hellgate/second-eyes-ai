# External agent-payer monitoring

Scaffolding to detect when an x402 settlement arrives from an **external agent
payer** — a payer wallet outside the known operator/test set — and to expose
that as an agent-readable signal. Read-only: no notifications are sent, no
secrets are touched, no crypto is spent.

Agent-facing language throughout: *external agent payer* / *distinct payer*,
never "customer" or "human".

## What counts as external

Every settled `access_grants` row carries the on-chain `payer_ref` (the paying
wallet). A settlement is **external** when its `payer_ref` is **not** in the
known operator/test wallet set. The signal reports distinct external payers, the
first one seen, and the latest settlement — masked addresses only.

## Known operator/test wallets

Defined in `functions/_lib/lounge/known-payers.js`. Built-in defaults (already
public on Base — see `docs/canary-revenue-ledger.json`):

| Wallet | Role |
| --- | --- |
| `0x180f6E73…04C2` | canary payer (`scripts/canary-pay.mjs`) |
| `0xFb891507…4427` | lounge payTo (self-transfers / sweeps) |

Extend the set **without a redeploy** via the `KNOWN_TEST_PAYERS` env var
(comma/space/newline-separated `0x` addresses). To ignore the built-in defaults
and use only your list, set `KNOWN_TEST_PAYERS_STRICT=1`.

```
KNOWN_TEST_PAYERS = "0xCiWallet1, 0xCiWallet2"
```

Configure it as a plain Pages/Worker var (these are public addresses, not
secrets) in `wrangler.toml` `[vars]`, the Cloudflare dashboard, or `.dev.vars`
locally. **Do not** add it as a Cloudflare secret.

## Where the signal surfaces

`external_payer_signal` is included in:

- `GET /api/bar/stats` → top-level `external_payer_signal`
- `GET /api/bar/proof/payments` → `external_payer_signal` (via `getPaymentProof`)

Shape:

```json
{
  "external_buyer_signal": true,
  "external_distinct_payers": 2,
  "first_external_payer_seen": {
    "payer": "0x028b…4Cbb",
    "tx_ref": "0x…",
    "basescan": "https://basescan.org/tx/0x…",
    "settled_at": "2026-…"
  },
  "latest_external_settlement": { "payer": "0x…", "tx_ref": "0x…", "basescan": "…", "settled_at": "…" },
  "known_test_payers_configured": 2
}
```

Privacy: only masked addresses (`0x1234…cdef`) and the already-public `tx_ref` /
basescan link are exposed — no more payer info than the existing ledger.

## Cron / notification hook

`scripts/check-external-payer.mjs` fetches `/api/bar/proof/payments` and exits:

- `0` — an external agent payer is present (`external_buyer_signal=true`)
- `1` — only known operator/test wallets have settled
- `2` — fetch/parse error

```bash
node scripts/check-external-payer.mjs                  # default https://second-eyes.ai
BASE=https://staging.example node scripts/check-external-payer.mjs
node scripts/check-external-payer.mjs --json           # compact JSON

# wire a notifier yourself (none is built in):
node scripts/check-external-payer.mjs && your-notify "external agent payer settled"
```

## Tests

- `node scripts/external-payer-smoke.mjs` — no network/DB; validates exclusion,
  env extension, strict mode, first/latest detection, and address masking.
- SQLite parity for the exclusion query is documented inline in the smoke
  suite's intent; the production query lives in `getExternalPayerSignal`.
