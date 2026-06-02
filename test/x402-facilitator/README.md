# CDP x402 facilitator integration test harness

Three layers. **Layers 1 and 2 are safe to run by any agent at any time. Layer 3
is the only layer that spends, and it is OFF unless triple-gated.** This harness
is the gate an operator agent clears before flipping a new payment rail
(`X402_POLYGON_ENABLED`, `X402_SOLANA_ACTIVE`) active in production.

It asserts against the real builder in
[`functions/_lib/x402.js`](../../functions/_lib/x402.js) and the rail registry in
[`functions/_lib/x402-networks.js`](../../functions/_lib/x402-networks.js) — the
same code paths a live 402 → verify → settle uses. No Vitest, no TypeScript: plain
Node ESM self-tests, exit 1 on failure, matching `scripts/*-selftest.mjs`.

```
test/x402-facilitator/
├── env.mjs               ← env loader, spend gates, wallet/key isolation, atomic units
├── mock-facilitator.mjs  ← globalThis.fetch monkey-patch + synthetic signed header
├── mocked.test.mjs       ← LAYER 1: mocked verify/settle, no network, no spend
├── dry-run.test.mjs      ← LAYER 2: live /supported reachability, no spend
├── settlement.test.mjs   ← LAYER 3: live verify+settle, real testnet USDC, triple-gated
├── signers.mjs           ← LAYER 3 only: real EIP-3009 / Solana signing (lazy import)
└── README.md
```

---

## Layer 1 — Mocked (always safe)

```sh
node test/x402-facilitator/mocked.test.mjs
```

No env vars, no network, no keys. Proves:

- `accepts[]` shape per env: **Base default**, **Polygon opt-in** (`X402_POLYGON_ENABLED=1`), **Solana double-gated** (`X402_SOLANA_PAY_TO` **and** `X402_SOLANA_ACTIVE=1`)
- Base (`eip155:8453`) is invariably `accepts[0]`
- CDP `/verify` receives **only the selected `accepts[]` entry** (the rail the buyer signed for), never the whole array
- CDP `/settle` reuses the **byte-identical** body `/verify` accepted — no rail swap between verify and settle
- A malformed or empty payment header is rejected **without** any facilitator call (`invalid_payment_header`)
- A buyer signing a rail **not** in `accepts[]` is never settled on the wrong rail (see "Network mismatch" below)
- Atomic-unit invariant: every `accepts[]` amount is integer USDC micros (`usdToUsdcMicros(0.001) === "1000"`), cross-checked against an independent `usdToAtomic()`
- The wallet-isolation gate fires when a test payTo equals a production payTo

### Network mismatch — documented real behavior

The PR #17 selector `selectAcceptForPayload` **falls back to `accepts[0]`** when the
buyer's signed network is not in `accepts[]` (intentional legacy single-rail
support). So a Solana-signed payment against a Base-only `accepts[]` is verified
against **Base**, and a real CDP facilitator rejects it because the signed payload
network cannot match the Base requirement. The load-bearing safety property the
harness asserts is therefore **"the server never builds or settles a requirement
for a rail the buyer did not sign for"** — not "no facilitator call." If you want a
hard pre-flight reject on unknown rails, that is a change to `x402-networks.js`, not
to this test.

---

## Layer 2 — Dry run (no spend, reachability only)

```sh
export TEST_FACILITATOR_URL_BASE_SEPOLIA=https://api.cdp.coinbase.com/platform
export TEST_FACILITATOR_URL_SOLANA_DEVNET=https://api.cdp.coinbase.com/platform
export TEST_FACILITATOR_URL_POLYGON_AMOY=https://x402-amoy.polygon.technology
node test/x402-facilitator/dry-run.test.mjs
```

GETs each **configured** facilitator's `/supported` endpoint and checks it
advertises the rail you plan to activate. Costs nothing — no signing, no verify,
no settle. **With no `TEST_FACILITATOR_URL_*` set it skips cleanly (exit 0) and
never touches the network.** Don't run it in a tight loop; CDP rate-limits
`/supported`.

---

## Layer 3 — Live settlement (real testnet USDC, opt-in)

**Default: skipped.** Every gate below must hold or the layer refuses to spend.

```sh
# 1. master switch (default off)
export RUN_X402_SETTLEMENT_TESTS=1
# 2. per-run spend cap (default $0.25, hard ceiling $5)
export MAX_TEST_SPEND_USD=0.05
# 3. testnet-only credentials — separate from every production wallet/key
export TEST_EVM_PRIVATE_KEY=0x...     # NEVER a mainnet-funded key
export TEST_EVM_PAY_TO=0x...          # MUST differ from X402_PAYTO / X402_POLYGON_PAY_TO
export TEST_SOLANA_SECRET_KEY=...     # base58, testnet only
export TEST_SOLANA_PAY_TO=...         # MUST differ from X402_SOLANA_PAY_TO
# 4. facilitator URLs from Layer 2
node test/x402-facilitator/settlement.test.mjs
```

Each settlement spends **$0.001** testnet USDC. The gates, in order:

1. `RUN_X402_SETTLEMENT_TESTS === "1"` — else skip (exit 0)
2. `MAX_TEST_SPEND_USD` ≤ `$5` — else abort (exit 1)
3. Per-rail `TEST_*` credentials present — else that rail is skipped, no spend
4. `assertTestPayToIsolation()` — test payTo ≠ production payTo, else abort
5. `assertTestKeyIsolation()` — test key ≠ production key, else abort
6. A mainnet-looking facilitator URL requires `ALLOW_MAINNET_SETTLEMENT="I_UNDERSTAND"`, else that rail is refused

EVM rails (Base Sepolia, Polygon Amoy) sign a real EIP-3009
`transferWithAuthorization` and run the full verify → settle loop. **Solana is
scaffolded but treated as unconfirmed** (matching PR #17): a Solana run records the
facilitator response but does not assert a pass, because the EVM-shaped request body
is not yet confirmed end-to-end against the CDP Solana facilitator.

This layer is a **release-gate ritual, not a CI check.** It needs funded testnet
wallets, and a flaky run would burn faucet allowance on every PR.

---

## Funding the test wallets (testnet only, all faucets free)

- **Base Sepolia** — tiny Base Sepolia ETH for gas + test USDC from <https://faucet.circle.com/>.
- **Polygon Amoy** — Amoy POL from <https://faucet.polygon.technology/> + test USDC from Circle.
- **Solana Devnet** — `solana airdrop 1 <addr> --url devnet` + test USDC from Circle. The first payment to a fresh `TEST_SOLANA_PAY_TO` creates the recipient USDC ATA, so expect it to be slower.

Generate a fresh **testnet** EVM keypair (never reuse production):

```sh
node -e "const a=require('viem/accounts'); const k=a.generatePrivateKey(); console.log(k, a.privateKeyToAccount(k).address)"
```

---

## How this gates Polygon / Solana activation

This harness is the explicit gate for flipping a new rail active. See
[`docs/x402-facilitator-testing.md`](../../docs/x402-facilitator-testing.md) for the
full activation checklist and the production env var mapping.

| To activate | Required green |
|---|---|
| **Base** (already active) | Layer 1 green + Layer 2 against the CDP facilitator green. No Layer 3 required. |
| **Polygon** (`X402_POLYGON_ENABLED=1`) | Layer 1 green (incl. Polygon `accepts[]`) + Layer 2 Amoy reachable + Layer 3 Amoy settles **3× consecutively** + one manual $0.01 mainnet smoke (document the tx hash, outside this suite). |
| **Solana** (`X402_SOLANA_ACTIVE=1`) | Layer 1 green (incl. Solana double-gate) + Layer 2 Devnet advertises a `solana:` network + operator confirms CDP settles Solana on our request shape + mainnet recipient USDC ATA pre-initialized. |

**Do NOT activate** if: a test payTo equals a production payTo (the harness refuses
to run anyway), `MAX_TEST_SPEND_USD` is unset/over `$5`, Layer 3 has not passed 3×,
or any Layer 2 probe fails or hangs.

## Env var reference

| Var | Layer | Default | Purpose |
|---|---|---|---|
| `TEST_FACILITATOR_URL_BASE_SEPOLIA` | 2/3 | `https://api.cdp.coinbase.com/platform` | Base Sepolia facilitator (CDP same URL; payload network selects rail) |
| `TEST_FACILITATOR_URL_POLYGON_AMOY` | 2/3 | `https://x402-amoy.polygon.technology` | Amoy facilitator (CDP does NOT cover Amoy) |
| `TEST_FACILITATOR_URL_SOLANA_DEVNET` | 2/3 | `https://api.cdp.coinbase.com/platform` | Solana Devnet facilitator |
| `TEST_EVM_PRIVATE_KEY` | 3 | unset | `0x` hex testnet key for Base Sepolia + Polygon Amoy. NEVER mainnet-funded. |
| `TEST_EVM_PAY_TO` | 3 | unset | Where test EVM payments land. MUST differ from `X402_PAYTO`. |
| `TEST_SOLANA_SECRET_KEY` | 3 | unset | base58 testnet Solana payer key |
| `TEST_SOLANA_PAY_TO` | 3 | unset | Test Solana recipient. MUST differ from `X402_SOLANA_PAY_TO`. |
| `RUN_X402_SETTLEMENT_TESTS` | 3 | unset | Must equal `"1"` to run any settlement |
| `MAX_TEST_SPEND_USD` | 3 | `0.25` | Per-run spend cap; hard ceiling `$5` |
| `ALLOW_MAINNET_SETTLEMENT` | 3 | unset | Must equal `"I_UNDERSTAND"` to permit a mainnet facilitator URL |
| `SOLANA_DEVNET_RPC_URL` | 3 | `https://api.devnet.solana.com` | Optional Solana RPC override |

Production rail vars (set by an operator, **not** by this harness):
`X402_PAYTO`, `X402_FACILITATOR_URL`, `X402_POLYGON_ENABLED`, `X402_POLYGON_PAY_TO`,
`X402_SOLANA_PAY_TO` (or `SOLANA_PAY_TO`), `X402_SOLANA_ACTIVE`,
`CDP_API_KEY_ID` / `CDP_API_KEY_NAME`, `CDP_API_KEY_SECRET`.
