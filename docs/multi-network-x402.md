# Multi-network x402

Second Eyes advertises paid x402 doors over an x402 **v2 `accepts[]`** array. v2
lets one 402 offer several payment rails; the buyer signs for whichever it can
pay. This document describes how Second Eyes offers more than one rail **without
fragmenting the product** — same endpoints, same work marks, same ledger.

## Core rule

> **Never advertise a rail the server cannot settle.** A broken `accepts[]` entry
> is worse than no entry: an agent can choose it, sign, spend — and the server
> rejects the settlement. The agent loses the money. So a rail enters `accepts[]`
> only when (a) it is configured AND (b) the server can verify + settle it.

Base (`eip155:8453`) is canonical and is **always `accepts[0]`**. Everything else
is opt-in and appends after Base.

> **Polygon needs a proof gate, not just a flag.** Polygon was once advertised off
> `X402_POLYGON_ENABLED=1` alone, before settlement was proven; the live canary then
> failed verification. The flag is now necessary but not sufficient — Polygon also
> needs a valid **activation record** (`config/x402-rail-activations.json` or
> `X402_POLYGON_ACTIVATION_RECORD`) attesting Amoy Layer 3 passed ≥3× and a mainnet
> smoke tx is documented, or an explicit emergency override. See
> [`docs/x402-facilitator-testing.md`](x402-facilitator-testing.md#activation-record-gate-the-canary-fix)
> and the gate in
> [`functions/_lib/x402-rail-activation.js`](../functions/_lib/x402-rail-activation.js).

The rail registry lives in [`functions/_lib/x402-networks.js`](../functions/_lib/x402-networks.js).
`resolveActiveNetworks(env)` decides what is accept-ready; `plannedNetworks(env)`
returns the roadmap rails surfaced in discovery but kept out of `accepts[]`.

## Rail status

| Rail | CAIP-2 | Status | How it settles | Activate with |
|------|--------|--------|----------------|---------------|
| **Base** | `eip155:8453` | **active** (default) | CDP facilitator, EVM EIP-712 USDC | `X402_PAYTO` (already set) |
| **Polygon** | `eip155:137` | **disabled** (after failed canary) | Same EVM EIP-712 path + same CDP facilitator; same merchant wallet works | `X402_POLYGON_ENABLED=1` **AND** a valid activation record (see below) |
| **Solana** | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | **planned (config-ready)** | CDP facilitator settles Solana SPL USDC, but our request-body shaping is EVM-shaped and is **not yet verified end-to-end** for SVM | `X402_SOLANA_PAY_TO` **and** `X402_SOLANA_ACTIVE=1` (after confirming settlement) |

## Environment variables

```
# Base (canonical) — already required
X402_PAYTO=0x...                 # Base USDC merchant wallet

# Polygon — EVM, low-risk opt-in
X402_POLYGON_ENABLED=1           # "1"/"true"/"yes"/"on" to enable
X402_POLYGON_PAY_TO=0x...        # optional; defaults to X402_PAYTO

# Solana — double-gated, OFF by default
X402_SOLANA_PAY_TO=...           # base58 Solana USDC receive address (or SOLANA_PAY_TO)
X402_SOLANA_ACTIVE=1             # "1" to actually enter accepts[]
```

Set Cloudflare Pages env via `wrangler pages secret put NAME` (or plain `[vars]`
in `wrangler.toml` for non-secret flags). **Do not** put a Solana address into the
EVM `X402_PAYTO`, and never guess a Solana address — it must be supplied by the
operator.

## Solana: what the operator must supply before flipping it on

Solana is intentionally scaffolded, not auto-active. Before setting
`X402_SOLANA_ACTIVE=1`:

1. **Provide a Solana USDC receive address** in `X402_SOLANA_PAY_TO` (the SPL
   token account / owner that should receive USDC mint
   `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`).
2. **Confirm the CDP facilitator settles Solana on our request shape.** Our
   `buildFacilitatorRequestBody` (in [`functions/_lib/x402.js`](../functions/_lib/x402.js))
   currently constructs an EVM-shaped `paymentPayload`/`paymentRequirements`. The
   Solana scheme (base58 mint, no EIP-712 domain) may need a different payload
   shape. Verify a real settlement (or a CDP sandbox settlement) succeeds end to
   end before advertising Solana as accepted.
3. Only then set `X402_SOLANA_ACTIVE=1`. Until both gates are satisfied, Solana
   stays in `planned_networks` and agents are told **not** to sign for it.

When Solana settlement is verified, change `SOLANA_NETWORK.status` to `"active"`
in the registry and, if the request shape differs, branch
`buildFacilitatorRequestBody` on `accept`'s namespace.

## Static vs live discovery

Static JSON under `public/.well-known/` cannot read runtime env, so it advertises
the **default posture**:

- `accepted_networks: ["eip155:8453"]`
- `planned_networks: [Polygon (activatable), Solana (planned)]`

The **live** API root reflects the real env-resolved state:

- `GET /api/bar` → `payment_activation.accepted_networks` / `.planned_networks` / `.rail_states`
- `GET /api/bar/enter` → same under `payment_activation`
- `GET /api/bar/proof` → `x402_rail_states` + `x402_config_warnings`

`rail_states` is the lifecycle map: `base` active/proven, `polygon`
disabled/unproven/active/emergency_override per the activation gate, `solana`
planned. It makes "the flag is set but the rail is NOT advertised" visible instead
of silent — an agent (or operator) sees `polygon: unproven` with the blocker
reasons rather than guessing from an absent `accepts[]` entry.

So an operator who sets `X402_POLYGON_ENABLED=1` will see `eip155:137` move from
`planned_networks` into `accepted_networks` on the live API (and in the actual
402 `accepts[]`), while the static files keep the conservative default. Agents are
instructed to read the **live `accepts[]` from the `PAYMENT-REQUIRED` header**, so
they always pay a rail the server can settle.

## How a buyer picks a rail

When `accepts[]` has more than one entry, the buyer signs for one and echoes its
network in `paymentPayload.accepted.network` (or a top-level `network`).
`selectAcceptForPayload` in the registry matches that to the right `accepts[]`
entry so a Polygon/Solana signer is verified against the correct rail — not
against Base `accepts[0]`. Legacy single-rail signers with no network fall back to
`accepts[0]` (Base), preserving current behavior.

## Verification (no crypto spend)

```bash
node scripts/x402-multinetwork-selftest.mjs       # rail gating + facilitator rail selection
node scripts/x402-rail-activation-selftest.mjs     # flag alone never advertises Polygon; record/override required
node scripts/discovery-consistency-check.mjs       # static surfaces: Base canonical, Solana never in accepted_networks
node scripts/x402-server-selftest.mjs              # Base 402 still payable by official @x402/fetch v2 (needs @x402 deps)
```

Live smoke (after deploy, no spend): `GET /api/bar` and confirm
`payment_activation.accepted_networks` matches your env (Base only by default;
`+eip155:137` when `X402_POLYGON_ENABLED=1`).

## Deploy

```bash
# enable Polygon (example) — requires a VALID activation record, not just the flag.
# 1. prove settlement and fill the record (see docs/x402-facilitator-testing.md):
#    edit config/x402-rail-activations.json → activated:true, amoy_layer3_passes>=3,
#    mainnet_smoke_tx:"0x…"  (or supply X402_POLYGON_ACTIVATION_RECORD as a secret)
# 2. set the flag and deploy:
wrangler pages secret put X402_POLYGON_ENABLED   # value: 1
npx wrangler pages deploy public --project-name second-eyes-ai
# then index the new rail on CDP Bazaar with a real settlement:
node scripts/canary-pay.mjs
```

The `Deploy Cloudflare Pages` workflow exposes `enable_polygon` and `disable_polygon`
`workflow_dispatch` inputs; `disable_polygon` deletes/zeroes `X402_POLYGON_ENABLED`
and wins when both are checked (fail-safe toward Base-only).

Disabling is a no-op revert: unset (or `0`) the flag and redeploy — `accepts[]`
returns to Base only with no other change. Note that even with the flag set,
Polygon stays out of `accepts[]` until a valid activation record exists, so an
accidental flag can never re-advertise an unproven rail.
