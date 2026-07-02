# SPEC.md — Substrate Increment 0

_Date: 2026-06-25 (updated 2026-07-02)_
_Status: Lane 1 (x402) and Lane 3 (Stripe) live. Lane 2 (AP2/card) and ERC-8004 registration planned._

## Three Framework Anchors

1. **AP2 — Agent Payments Protocol** — `github.com/google-agentic-commerce/AP2`
   - Three-mandate VDC system (Intent → Cart → Payment)
   - Backed by 60+ orgs incl. Mastercard, Visa, PayPal, Coinbase
   - Role: verified-agent payment rail (Lanes 2a/2b) — any external verified agent carrying card mandates; not limited to internal use

2. **x402 Bazaar — Discovery + Payments**
   - CDP facilitator: `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`
   - Spec repo: `github.com/x402-foundation/x402`
   - Community Bazaar w/ ERC-8004 trust scoring: `github.com/rplryan/x402-discovery-mcp`
   - Role: HTTP-402 rail (USDC on Base) + public discovery, no allowlist

3. **ERC-8004 — Trustless Agents** (ratified Jan 2026)
   - Registries: Identity, Reputation, Validation
   - Pairs natively with x402 for settlement
   - Role: open reputation layer readable by any caller; also used internally as the on-chain accounting/validation log for the Earn-to-Burn ledger (see Increment 0 step 4)

## Stack Alignment (open-to-everyone)

| Layer | Protocol | Substrate use |
|---|---|---|
| Identity / Reputation | ERC-8004 | Open registry; anyone queryable |
| Payments | x402 (USDC/Base) | Open HTTP 402 rail, no allowlist |
| Discovery | x402 Bazaar | Substrate endpoints registered publicly |
| Authorization | AP2 mandates | Verified-agent payment rail (Lanes 2a/2b); open to any external agent with card mandates |
| Transport | A2A / MCP | A2A endpoint at `/api/a4a`; MCP via `@secondeyes/mcp-unblock` (npm) |

## Funding Lanes (all feed one Earn-to-Burn ledger)

| Lane | Rail | Caller type | Settlement | Status |
|---|---|---|---|---|
| 1 | x402 / USDC on Base | Autonomous agent | On-chain, sub-second | **Live** |
| 2a | AP2 + Mastercard VDC | Verified agent w/ card mandate | Card network | Planned |
| 2b | AP2 + Visa VDC | Verified agent w/ card mandate | Card network | Planned |
| 3 | Stripe ACP checkout | Human or low-trust agent | Stripe | **Live** |

Cards are additive optional doors, never gates. x402/USDC remains the default machine rail. Lanes 2a/2b require partner TOS acceptance and are not yet wired in code.

## MCP Package

**`@secondeyes/mcp-unblock`** (`packages/secondeye-mcp/`) is the primary agent-facing access path. It is a published npm package that proxies the lounge REST API over the MCP stdio transport, so any MCP client (Cursor, Claude Code, etc.) gets the full tool set without manual HTTP.

Key properties:
- Tools: `proof_bar`, `enter_lounge`, `pause_and_route`, `order_service`, `leave_with_receipt`, `read_menu`, `read_pricing`, `fetch_catalog`, `github_mcp_401_fix`
- Wallet: set `MCP_X402_WALLET_KEY` on the process; the package auto-settles x402 v2 payments inline (USDC on Base, `eip155:8453`) up to a configurable spend cap
- Current release: `@1.2.4` — required for x402 v2; `@1.0.x` is free-reads-only fallback, no wallet
- Install: `npx @secondeyes/mcp-unblock@1.2.4` — configure in any MCP client config

## x402 Status

The full x402 v2 challenge/response cycle is implemented and validated: HTTP 402 response → agent decodes `PAYMENT-REQUIRED` header → EIP-712 payment header signed by agent wallet → CDP facilitator verify → CDP facilitator settle → `X-PAYMENT-RESPONSE` returned. Live on all `/api/bar/x402/` routes and the `/api/access/purchase` agent tab endpoint. The MCP package (`packages/secondeye-mcp`) carries an auto-pay wallet that completes this cycle inline.

## Increment 0 — Status

1. ✅ **Open ingress:** All `/api/bar/x402/` endpoints return HTTP 402 and are registered in the CDP facilitator catalog and community Bazaar.
2. ⏳ **Identity:** ERC-8004 Identity Registry publication pending operator action.
3. ⏳ **AP2 verified-agent rail:** Three-mandate VDC verification (Intent/Cart/Payment) for any external verified agent on Lanes 2a/2b — planned; no VDC code wired yet.
4. ✅ **Three-tier funding wiring:** x402 receipts recorded (Earn-to-Burn ledger). AP2 Cart mandates and ERC-8004 validation log accounting are planned alongside Lane 2 wiring.
5. ⏳ **Audit log:** Lane 2 transaction logging with mandate hash + payment txid — pending AP2 wiring.

## Operator Prerequisites

The following require direct operator action and cannot be scaffolded by code alone:

- Paste Stripe / Mastercard / Visa / Coinbase merchant API keys into GitHub Settings → Secrets
- Accept partner TOS for any card network before enabling AP2 card rails
- Provide wallet seed phrases or signing keys via secure environment injection (never in code)

All code scaffolding and verification logic lives in-repo. Secrets are operator-managed.
