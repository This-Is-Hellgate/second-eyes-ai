# Coinbase x402 — finish when parked (~3 min)

You're on **CDP sign-in** in Chrome. Cloudflare is ready to receive secrets.

## Already automated (no action)

- CDP JWT auth wired in the bar code
- `ACCESS_TOKEN_SECRET` + `X402_FACILITATOR_URL` can be pushed via script
- D1 migration + deploy can run from terminal

## When parked — CDP portal

1. Sign in at **portal.cdp.coinbase.com** (passkey/Google is fastest).
2. **API Keys** → **Secret API keys** → **Create** → name `second-eye-x402`.
3. Copy **Key name** (`organizations/.../apiKeys/...`) and **private key** (once).
4. **Wallets** → create or open EVM wallet → copy **Base** address (`0x…`).

## One command on your PC

Create `.env.local` from `.env.example`, paste the three values, then:

```powershell
cd "c:\Users\mchay\OneDrive\Desktop\This is It"
node scripts/push-coinbase-secrets.mjs
npx wrangler pages deploy public --project-name second-eyes-ai
```

## Verify (phone or laptop)

```text
https://secondeyesai.com/api/bar/proof
```

Paid tap should return **402** (not 503):

```text
https://secondeyesai.com/api/bar/taps/mcp-stdio-vs-sse
```
