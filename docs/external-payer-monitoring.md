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
  "unclassified_payer_clusters": [
    {
      "payer": "0x028b…4Cbb",
      "settlements": 2,
      "first_tx_ref": "0x…",
      "first_basescan": "https://basescan.org/tx/0x…",
      "first_settled_at": "2026-…",
      "latest_settled_at": "2026-…"
    }
  ],
  "masked_payer_warning": "N external payer(s) are reported masked and cannot be silenced by mask alone…",
  "known_test_payers_configured": 2
}
```

`unclassified_payer_clusters` groups every external settlement by its full
(server-side) payer address — one entry per distinct external payer not in
`KNOWN_TEST_PAYERS`, with a settlement count and the first `tx_ref` to resolve.
`masked_payer_warning` is non-null whenever at least one external payer is
present; it reminds operators that a **mask cannot** be added to
`KNOWN_TEST_PAYERS` (the match is on the full `0x` address).

Privacy: only masked addresses (`0x1234…cdef`) and the already-public `tx_ref` /
basescan link are exposed — no more payer info than the existing ledger. The
full payer address never leaves the worker.

## Classifying a masked payer

The signal masks payers (e.g. `0x028b…4Cbb`) the same way the public ledger
does. The **full** address lives only in the D1 `access_grants.payer_ref`
column and is never emitted by any endpoint. To add a masked operator/test
wallet to `KNOWN_TEST_PAYERS` you must first recover its full address — and you
must do so **without guessing**: the middle bytes are not derivable from the
mask.

Two secret-free recovery paths (use either; neither exposes anything the public
ledger does not already):

1. **Resolve the public tx on Base (no project access at all).** Take the
   cluster's `first_tx_ref` from `unclassified_payer_clusters` (or
   `first_external_payer_seen.tx_ref`) and open `first_basescan`. The USDC
   transfer's **From** address is the full payer wallet. This needs no D1 access
   and no secrets — `tx_ref` is already public.
2. **Query D1 directly (needs Cloudflare D1 read creds — these are secrets).**
   Operators with a D1-read token can read the full address:

   ```bash
   npx wrangler d1 execute second-eyes-lawful-loop --remote \
     --command "SELECT DISTINCT payer_ref FROM access_grants WHERE payer_ref IS NOT NULL;" --json -y
   ```

Path 1 is preferred for classification because it requires no project secrets.
Once you have the **full** address and have confirmed it is an operator/test
wallet (not a genuine external agent payer), add it verbatim to
`KNOWN_TEST_PAYERS`:

```
KNOWN_TEST_PAYERS = "0xFullAddressRecoveredFromBase, 0xAnotherTestWallet"
```

> Do **not** put a masked form (`0x028b…4Cbb`) in `KNOWN_TEST_PAYERS`. Matching
> is on the normalized full address, so a mask would never exclude the payer and
> the warning would persist.

> If you cannot recover the full address with confidence, leave it out. A
> genuine external agent payer staying visible is the correct, safe default —
> never substitute a guessed address.

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

When external payers are present, the plain-text run (no `--json`) also
prints each `unclassified_payer_clusters` entry to stderr — masked payer,
settlement count, and the `first_tx_ref`/basescan link to resolve — followed by
the `masked_payer_warning`. Pipe stdout for machine output and read stderr for
the classification punch list.

## Tests

- `node scripts/external-payer-smoke.mjs` — no network/DB; validates exclusion,
  env extension, strict mode, first/latest detection, address masking, cluster
  grouping, and the masked-payer warning.
- SQLite parity for the exclusion query is documented inline in the smoke
  suite's intent; the production query lives in `getExternalPayerSignal`.

## D1 migrations — avoiding scary duplicate-column failures

Adding `KNOWN_TEST_PAYERS` is a plain env change and needs **no** migration.
This section is for the unrelated D1 schema seeds under `seeds/` that some
operators run alongside monitoring work.

SQLite `ALTER TABLE … ADD COLUMN` is **not idempotent**: re-running a seed that
already applied fails with `duplicate column name: <col>`. That error looks
alarming but is harmless — it means the column already exists. Do not "fix" it
by editing data; just confirm and skip.

**Preflight (read-only) — confirm before applying.** Run the dry-run check for
the columns a seed adds; if it returns rows, the migration already ran — skip
the `ALTER`s:

```bash
# Example for seeds/grant-product-metadata.sql (product_kind / product_slug):
npx wrangler d1 execute second-eyes-lawful-loop --remote \
  --command "SELECT name FROM pragma_table_info('access_grants') WHERE name IN ('product_kind','product_slug');" --json -y
# Zero rows → safe to apply. Rows returned → already applied, skip the ALTERs.
```

Seeds that add columns and their dry-run targets:

| Seed | Table | Columns | Already-applied check returns these |
| --- | --- | --- | --- |
| `grant-product-metadata.sql` | `access_grants` | `product_kind`, `product_slug` | either column name |
| `bazaar-status.sql` | `access_grants` | `bazaar_status`, `bazaar_reason` | either column name |
| `agent-mark-lineage.sql` | `agent_marks` | `referred_by_mark_id` | the column name |

**Runtime self-heal.** `access_grants.product_kind`/`product_slug` are also added
lazily on first write by `ensureGrantProductColumns` in
`functions/_lib/a4a-store.js` (it gates on `pragma_table_info`, so it never
double-applies). If you only need those columns, a deploy + first settlement
backfills them without running the seed at all.

This doc only documents the preflight — **do not run migrations as part of
monitoring work.** Use the manual-dispatch `D1 migrate` workflow
(`.github/workflows/d1-migrate.yml`) when a schema change is actually intended.
