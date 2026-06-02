# x402 facilitator testing & rail-activation gate

This is the operator-agent checklist for proving a CDP x402 payment rail before
flipping it active in production. The test harness lives in
[`test/x402-facilitator/`](../test/x402-facilitator/README.md); this doc is the
gate that consumes it.

It builds on the multi-network design in
[`docs/multi-network-x402.md`](multi-network-x402.md): Base is the canonical
`accepts[0]`, Polygon is an EVM opt-in, Solana is a double-gated SVM scaffold.

## Why three layers

| Layer | Spends? | Network? | When |
|---|---|---|---|
| 1 — mocked | no | no | every change, CI |
| 2 — dry-run `/supported` | no | yes | before trusting a facilitator URL |
| 3 — live settlement | **yes** (testnet) | yes | release-gate ritual only |

Layer 1 proves the builder logic (rail gating, single-requirement verify/settle,
atomic units, header rejection). Layer 2 proves the facilitator URL is real and
advertises the rail. Layer 3 proves an end-to-end testnet payment actually
settles. The layers are cumulative: you do not run Layer 3 for a rail whose
Layer 2 probe is red.

## Quick run

```sh
# Layer 1 — always
node test/x402-facilitator/mocked.test.mjs

# Layer 2 — set the facilitator URLs you want to probe (no spend)
TEST_FACILITATOR_URL_BASE_SEPOLIA=https://api.cdp.coinbase.com/platform/v2/x402 \
  node test/x402-facilitator/dry-run.test.mjs

# Layer 3 — triple-gated, testnet wallets only (see test README)
RUN_X402_SETTLEMENT_TESTS=1 MAX_TEST_SPEND_USD=0.05 \
TEST_EVM_PRIVATE_KEY=0x... TEST_EVM_PAY_TO=0x... \
TEST_FACILITATOR_URL_BASE_SEPOLIA=https://api.cdp.coinbase.com/platform/v2/x402 \
  node test/x402-facilitator/settlement.test.mjs
```

Or run Layers 1+2 together (Layer 3 stays opt-in):

```sh
node scripts/x402-facilitator-tests.mjs
```

## Production ↔ test env mapping

The harness uses the repo's **real** production var names so an operator does not
have to learn a parallel vocabulary:

| Production rail var | Test counterpart | Isolation rule |
|---|---|---|
| `X402_PAYTO` (Base recipient) | `TEST_EVM_PAY_TO` | must differ |
| `X402_POLYGON_PAY_TO` (optional) | `TEST_EVM_PAY_TO` | must differ |
| `X402_SOLANA_PAY_TO` / `SOLANA_PAY_TO` | `TEST_SOLANA_PAY_TO` | must differ |
| `X402_FACILITATOR_URL` (mainnet CDP) | `TEST_FACILITATOR_URL_*` (testnet) | testnet URLs by default |
| production signing / CDP key | `TEST_EVM_PRIVATE_KEY`, `TEST_SOLANA_SECRET_KEY` | must differ |

`env.mjs` enforces the isolation rules; the layer aborts (exit 1) on any collision.

## Activation gate

### Base USDC (already active — sanity check)
- Layer 1 green.
- Layer 2 against the CDP facilitator green.
- No Layer 3 required — this rail is in production.

### Polygon USDC — before `X402_POLYGON_ENABLED=1`
- Layer 1 green, **including** the Polygon `accepts[]` shape tests.
- Layer 2 against `TEST_FACILITATOR_URL_POLYGON_AMOY` returns 200 and advertises Amoy (or a non-empty body).
- Layer 3 Amoy settlement passes **3× consecutively**.
- One manual Polygon mainnet test against `X402_POLYGON_PAY_TO` with a $0.01 transfer — outside this suite; document the tx hash.

### Solana USDC — before `X402_SOLANA_ACTIVE=1`
- Layer 1 green, **including** the Solana double-gate tests.
- Layer 2 against `TEST_FACILITATOR_URL_SOLANA_DEVNET` advertises a `solana:` network.
- Operator confirms the CDP Solana facilitator settles on our request shape (see `docs/multi-network-x402.md`); until then Solana stays `planned` and never enters `accepts[]`.
- Mainnet recipient USDC ATA for `X402_SOLANA_PAY_TO` is pre-initialized (verify with a 0-amount transfer, not through this suite).

### Hard stops — do NOT activate if
- a `TEST_*` payTo equals a production payTo (the harness refuses anyway),
- `MAX_TEST_SPEND_USD` is unset or `> $5`,
- Layer 3 has not passed at least 3 consecutive times,
- any Layer 2 probe fails or hangs.

## CI

Run Layers 1 + 2 in CI; never Layer 3 (it needs funded wallets and would burn
faucet allowance per PR). See `.github/workflows/discovery-check.yml` for where
to add the Layer 1 step alongside the existing self-tests.
