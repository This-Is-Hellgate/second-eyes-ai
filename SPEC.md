# SPEC.md — Substrate Increment 0

_Date: 2026-06-25_
_Status: committed plan, pre-implementation_

## Three Framework Anchors

1. **AP2 — Agent Payments Protocol** — `github.com/google-agentic-commerce/AP2`
   - Three-mandate VDC system (Intent → Cart → Payment)
   - Backed by 60+ orgs incl. Mastercard, Visa, PayPal, Coinbase
   - Role: credential-gated doors for **internal ephemeral spawn only**

2. **x402 Bazaar — Discovery + Payments**
   - CDP facilitator: `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`
   - Spec repo: `github.com/x402-foundation/x402`
   - Community Bazaar w/ ERC-8004 trust scoring: `github.com/rplryan/x402-discovery-mcp`
   - Role: HTTP-402 rail (USDC on Base) + public discovery, no allowlist

3. **ERC-8004 — Trustless Agents** (ratified Jan 2026)
   - Registries: Identity, Reputation, Validation
   - Pairs natively with x402 for settlement
   - Role: open reputation layer; read by callers, never enforced by us

## Stack Alignment (open-to-everyone)

| Layer | Protocol | Substrate use |
|---|---|---|
| Identity / Reputation | ERC-8004 | Open registry; anyone queryable |
| Payments | x402 (USDC/Base) | Open HTTP 402 rail, no allowlist |
| Discovery | x402 Bazaar | Substrate endpoints registered publicly |
| Authorization | AP2 mandates | Gates internal ephemeral spawn, NOT external access |
| Transport | A2A / MCP | Existing |

## Funding Lanes (all feed one Earn-to-Burn ledger)

| Lane | Rail | Caller type | Settlement |
|---|---|---|---|
| 1 | x402 / USDC on Base | Autonomous agent | On-chain, sub-second |
| 2a | AP2 + Mastercard VDC | Verified agent w/ card mandate | Card network |
| 2b | AP2 + Visa VDC | Verified agent w/ card mandate | Card network |
| 3 | Stripe ACP checkout | Human or low-trust agent | Stripe |

Cards are additive optional doors, never gates. x402/USDC remains the default machine rail.

## Key Correction Carried Forward

Canary proved only **USDC receipt** on the wallet — it did **not** prove an x402 handshake. Increment 0 must implement and verify the actual 402 challenge/response cycle (EIP-712 signature + facilitator settle) before claiming x402 support.

## Increment 0 — Concrete Steps

1. **Open ingress:** Mark substrate endpoints with HTTP 402 responses; register in both CDP facilitator catalog and community Bazaar.
2. **Identity:** Publish substrate agent in ERC-8004 Identity Registry; expose Reputation/Validation reads.
3. **Internal credential door:** AP2 three-mandate verification (Intent/Cart/Payment VDCs) required only for internal ephemeral spawn (Compiler, Groundskeepers) — never for outside read/pay.
4. **Three-tier funding wiring:** Earn-to-Burn (x402 receipts) → demand pre-payment (AP2 Cart mandates) → fixed budget cap (on-chain accounting via ERC-8004 validation log).
5. **Audit log:** All ephemeral spawns logged with mandate hash + payment txid; readable publicly to preserve openness.

## Operator Prerequisites

The following require direct operator action and cannot be scaffolded by code alone:

- Paste Stripe / Mastercard / Visa / Coinbase merchant API keys into GitHub Settings → Secrets
- Accept partner TOS for any card network before enabling AP2 card rails
- Provide wallet seed phrases or signing keys via secure environment injection (never in code)

All code scaffolding and verification logic lives in-repo. Secrets are operator-managed.
