# Polygon canary — repo-native runbook (no Cursor/browser composer)

The Polygon mainnet canary failed `verify` and the rail was disabled (PR #19 added
the redacted facilitator diagnostics that made the failure legible). This is the
repo-native tooling to re-run that canary safely, entirely from scripts + a manual
GitHub workflow — no Cursor composer, no browser, no ad-hoc spend.

Three things, in escalating risk order:

| Step | Spends? | Network? | Tool |
|---|---|---|---|
| 1. Preflight | no | optional | `scripts/polygon-canary-preflight.mjs` |
| 2. Amoy Layer 3 | testnet only | yes | `test/x402-facilitator/settlement.test.mjs` |
| 3. Mainnet canary | **yes (≤ $1)** | yes | `scripts/polygon-canary.mjs` |

It builds on the existing CDP facilitator harness in
[`test/x402-facilitator/`](../test/x402-facilitator/README.md) and the rail registry
in [`functions/_lib/x402-networks.js`](../functions/_lib/x402-networks.js). The canary
pays through the **same** production `verify → settle` path the Worker uses
([`functions/_lib/x402.js`](../functions/_lib/x402.js)), so a green canary proves the
real path, not a parallel one.

---

## Step 1 — Preflight (no spend)

Answers: *if I enabled Polygon now, what would the server advertise, and is the live
help-me door still serving a payable 402?* No signing, no verify, no settle.

```sh
# Offline rail-resolution proof only (CI default, no network):
POLYGON_CANARY_MOCK=1 node scripts/polygon-canary-preflight.mjs

# Live no-spend probe of the production help-me door:
node scripts/polygon-canary-preflight.mjs

# Probe a different env / endpoint:
POLYGON_CANARY_TARGET_URL=https://secondeyesai.com/api/bar/x402/help-me \
  node scripts/polygon-canary-preflight.mjs
```

**Pass:** exit 0; section [1] shows Polygon (`eip155:137`) would enter `accepts[]`
with `X402_POLYGON_ENABLED=1`; section [2] shows the live door returns **HTTP 402**
with a non-empty `accepts[]` and a `PAYMENT-REQUIRED` header.

**Fail (exit 1):** live door not 402, empty `accepts[]`, missing `PAYMENT-REQUIRED`,
or Polygon would not resolve a payTo. Do not proceed.

A Polygon rail that is *not yet advertised live* is reported, not a failure — that is
the expected state after the rail was disabled.

---

## Step 2 — Amoy Layer 3 (testnet settlement, free)

Prove the full EVM verify → settle loop on **Polygon Amoy testnet** before risking a
single mainnet cent. This is the existing harness Layer 3, scoped to Amoy.

```sh
export RUN_X402_SETTLEMENT_TESTS=1
export MAX_TEST_SPEND_USD=0.05
export TEST_EVM_PRIVATE_KEY=0x...     # testnet throwaway, NEVER mainnet-funded
export TEST_EVM_PAY_TO=0x...          # MUST differ from X402_PAYTO / X402_POLYGON_PAY_TO
export TEST_FACILITATOR_URL_POLYGON_AMOY=https://x402-amoy.polygon.technology
node test/x402-facilitator/settlement.test.mjs
```

Fund: Amoy POL from <https://faucet.polygon.technology/> + test USDC from
<https://faucet.circle.com/>. **Pass criteria:** 3 consecutive green Amoy settlements
(per the harness activation table). Each spends $0.001 testnet USDC.

---

## Step 3 — Mainnet canary (gated live spend, ≤ $1)

`scripts/polygon-canary.mjs` is the only tool here that spends real Polygon USDC. It
aborts before signing unless **all** gates clear:

| Gate | Env | Behavior |
|---|---|---|
| 1 master switch | `RUN_POLYGON_CANARY=1` | else skip (exit 0, no spend) |
| 2 payer key | `POLYGON_CANARY_PRIVATE_KEY` | required; never logged |
| 3 expected payTo | `POLYGON_CANARY_EXPECTED_PAYTO` | must equal the built accept's payTo |
| 4 exact amount | `POLYGON_CANARY_EXPECTED_AMOUNT_USD` | must equal the built micros |
| 5 per-run cap | `POLYGON_CANARY_MAX_USD` (default 0.05) | hard ceiling **$1**; amount ≤ cap |
| 6 asset + network | `POLYGON_CANARY_EXPECTED_ASSET` / `_NETWORK` | must match the built accept (defaults to canonical Polygon USDC + `eip155:137`) |
| 7 wallet balance | `POLYGON_CANARY_MAX_WALLET_USDC` (default 5) | **aborts if the wallet holds more** — a canary key must be a low-balance throwaway |
| 8 no self-pay | derived payer address | aborts if payer == payTo |

```sh
export RUN_POLYGON_CANARY=1
export POLYGON_CANARY_PRIVATE_KEY=0x...           # low-balance throwaway, NOT treasury
export POLYGON_CANARY_EXPECTED_PAYTO=0x...        # production Polygon merchant payTo
export POLYGON_CANARY_EXPECTED_AMOUNT_USD=0.01
export POLYGON_CANARY_MAX_USD=0.05
export POLYGON_CANARY_MAX_WALLET_USDC=5
export X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform
export CDP_API_KEY_ID=...  CDP_API_KEY_SECRET=...
node scripts/polygon-canary.mjs
```

**Pass:** exit 0; prints `POLYGON CANARY OK — settled.` with a `tx` hash and a
`polygonscan.com/tx/...` link.

**Fail (exit 1):** prints the abort reason (which gate), or — on a verify/settle
failure — the **stage**, the facilitator **`invalidReason`**, and a redacted
facilitator body. A verify failure means **no spend occurred**.

### Mock mode (CI, no spend, no keys)

```sh
POLYGON_CANARY_MOCK=1 node scripts/polygon-canary.mjs   # exercises gates 1-8 offline
node test/x402-facilitator/polygon-canary.test.mjs      # gate matrix assertions
```

Both run in CI via `node scripts/x402-facilitator-tests.mjs` — no secrets needed.

---

## Capturing the failure (the whole point)

When the canary fails verify/settle, capture:

- **`invalidReason`** — printed on the `VERIFY FAILED` line. This is the CDP
  facilitator's machine reason (e.g. `insufficient_funds`, `invalid_signature`,
  `unsupported_payment_network`). It is the single most useful field for diagnosis.
- **stage** — `parse` / `auth` / `select` / `verify` / `settle`. Tells you how far the
  payment got. A `select` failure means the rail wasn't in `accepts[]` (config drift);
  a `verify` failure is the facilitator rejecting the signed payment.
- **redacted facilitator body** — printed after the failure line; signature/secret
  fields are stripped by `redactFacilitatorBody`.
- **tx hash** — on success only, from `settled.receipt.transaction` and the
  polygonscan link.

These come straight from PR #19's diagnostics in `verifyPaymentHeader`. Paste the
`invalidReason` + stage into the issue when reporting a failed canary.

---

## GitHub Actions (manual, default no-spend)

`.github/workflows/polygon-canary.yml` — **workflow_dispatch** only.

- **Plain run:** mock preflight + mock canary gates. No network, no secrets, no spend.
- **`live_preflight: true`:** also runs the live no-spend preflight against production.
- **Spending canary:** runs only when **all** hold — `run_settlement: true`,
  `confirm: I_UNDERSTAND_SPEND`, and the `POLYGON_CANARY_PRIVATE_KEY` repo secret is
  set. Inputs (`expected_payto`, `expected_amount_usd`, `max_usd`, `max_wallet_usdc`)
  feed the script's gates. Missing any guard → no spend.

Required secrets for the spending job: `POLYGON_CANARY_PRIVATE_KEY`, `CDP_API_KEY_ID`,
`CDP_API_KEY_SECRET` (optionally `X402_FACILITATOR_URL`, `CDP_API_KEY_NAME`,
`POLYGON_CANARY_RPC_URL`). The canary key must be a **low-balance throwaway** — Gate 7
aborts a hot wallet.

---

## Activating Polygon in production (after a green canary)

The canary does **not** flip the rail. To activate, an operator sets the production env
on the Worker:

```
X402_POLYGON_ENABLED=1
# optional dedicated merchant wallet (defaults to X402_PAYTO):
X402_POLYGON_PAY_TO=0x...
```

Then re-run `node scripts/polygon-canary-preflight.mjs` — section [2] should now show
Polygon advertised live in the help-me `accepts[]`.

## Rollback

Polygon is **off by default** — the rail only appears when `X402_POLYGON_ENABLED` is
truthy. To roll back after a bad activation:

1. **Disable the rail:** unset `X402_POLYGON_ENABLED` (or set it to `0`) on the Worker
   and redeploy. With no Polygon accept advertised, no new agent can choose the rail.
   Base (`eip155:8453`) stays `accepts[0]` and is unaffected.
2. **Confirm:** run `node scripts/polygon-canary-preflight.mjs`; section [2] should no
   longer list `eip155:137`.
3. **Stop further canaries:** unset `RUN_POLYGON_CANARY` (and remove the
   `POLYGON_CANARY_PRIVATE_KEY` secret) so neither the script nor the workflow can spend.
4. **Drain the canary wallet** if it still holds USDC — it is a throwaway, so sweep any
   remaining balance to the treasury and rotate the key.

No production data migration or schema change is involved; activation is a single
config flag, so rollback is just unsetting it.
