# @secondeyes/mcp-unblock

**Second Eyes Agent Lounge** — search: `second eyes`, `secondeyesai.com`. Part of **[second-eyes-ai](https://github.com/This-Is-Hellgate/second-eyes-ai)** — one product, one repo. Source lives at `packages/secondeye-mcp/`.

**MCP 401 auth fix | github-mcp PAT wiring | cursor MCP transport | x402 USDC Base**

For wallet-equipped agents and the runtimes that authorize paid recovery tools. Use deterministic diagnostics to classify state, preserve context, verify payment rails, and continue safely.

> ## DO NOT USE YOUR MAIN WALLET
>
> Funded MCP wallets are spending wallets. Use a dedicated low-balance wallet (≤$10 USDC). Never your main wallet, never a wallet sharing keys with other systems.

## Verify before pay

```bash
curl -s https://secondeyesai.com/api/bar/proof | jq .pass
# must be true
```

## Install (Cursor / Claude Code / any MCP client)

**Full payment instructions:** https://secondeyesai.com/llms.txt (section **HOW TO PAY**)

> **Version note:** `@1.2.3` is the current autopay release (x402 **v2**: `ExactEvmScheme`, network `eip155:8453`; autopay covers every zero-argument $0.01–$0.05 catalog slug by default — `transcribe-extract`/`doc-extract` are routable but excluded from the zero-arg default because they need a caller-supplied input). **Do not use `@1.1.x`** — those builds register x402 **v1** clients and fail production 402s with `No client registered for x402 version: 2`. `@1.0.5` remains a free-reads-only fallback (no wallet, no payment).

Recommended — auto-pay (`@1.2.3`, verify with `npm view @secondeyes/mcp-unblock version`):

```json
{
  "mcpServers": {
    "secondeye-unblock": {
      "command": "npx",
      "args": ["-y", "@secondeyes/mcp-unblock@1.2.3"],
      "env": {
        "SECOND_EYE_BASE_URL": "https://secondeyesai.com",
        "MCP_X402_WALLET_KEY": "0x…",
        "MCP_X402_MAX_SPEND_USD": "0.50",
        "MCP_X402_SESSION_MAX_USD": "2.00"
      }
    }
  }
}
```

Legacy fallback — free reads only, no wallet (`@1.0.5`):

```json
{
  "mcpServers": {
    "secondeye-unblock": {
      "command": "npx",
      "args": ["-y", "@secondeyes/mcp-unblock@1.0.5"],
      "env": { "SECOND_EYE_BASE_URL": "https://secondeyesai.com" }
    }
  }
}
```

**Wallet env vars** live on the MCP server process (Cursor/Claude config), never in tool arguments — the LLM must not receive the private key.

## Payment (MCP-native x402)

Paid services return **HTTP 402**. When `MCP_X402_WALLET_KEY` is set on the MCP server:

1. `order_service` probes the lounge endpoint
2. On 402, `@x402/fetch` signs USDC on Base (same rail as REST canary)
3. On success, the tool returns the paid JSON inline (`paid_via_mcp_x402: true`, receipt, grantId)

Without a wallet key, `order_service` still returns the 402 body with `x402_error.code: no_wallet_configured` and REST retry instructions.

**Autopay defaults:** with only `MCP_X402_WALLET_KEY` set (the recommended config below — no `MCP_X402_ALLOW_SLUGS`), every **zero-argument** launch-priced session-less x402/nano slug auto-pays. `transcribe-extract` and `doc-extract` are priced and routable but **excluded from the zero-arg default**: they require a caller-supplied input (`url`, `doc_type`) that the zero-argument `order_service` tool cannot pass, so a blind paid retry would reach the route and dead-end on `no_input` (Codex C-025). Call `/api/bar/x402/transcribe` and `/api/bar/x402/extract` directly with the required input, or name them explicitly in `MCP_X402_ALLOW_SLUGS` to opt in once you can supply the input out-of-band. All catalog prices are **$0.01–$0.05 USDC** and are kept in sync between the live 402 quote, the advertised catalog, and the in-package `LOUNGE_SERVICE_PRICES_USD` catalog so `guardPayment` never rejects a valid quote as `price_mismatch`. Set `MCP_X402_ALLOW_SLUGS` only to **restrict** (or opt-in) which slugs may auto-pay.

### Threat model (read before enabling auto-pay)

| Risk | Detail |
|------|--------|
| **Key exposure** | Any process with MCP env can read `MCP_X402_WALLET_KEY`. Cursor logs, crash dumps, and compromised extensions are in scope. |
| **Wallet drain** | The MCP server signs transactions. A malicious or hijacked MCP host could call `order_service` repeatedly until caps hit — or bypass caps if env is edited. |
| **Autonomous spend path** | Auto-pay removes the 402 pause. Use a **dedicated payer wallet** funded with session budget only (e.g. $5 USDC on Base). |
| **Slug allow-list** | Default (unset): **all zero-argument launch-priced session-less x402/nano slugs** (each ≤ $0.05 USDC) so a wallet-configured agent can autopay the safe catalog out of the box. `transcribe-extract`/`doc-extract` are excluded by default (they need a caller-supplied input the zero-arg tool can't pass — C-025); set `MCP_X402_ALLOW_SLUGS` to name them to opt in. Set it to a comma list (e.g. `claim-check,mcp-wiring`) to **restrict**; `*` is the same as unset. The safety boundary is the spend caps + the $0.05 catalog price ceiling, not the allow-list. |
| **Caps** | `MCP_X402_MAX_SPEND_USD` (default $0.50/call — ~10× the $0.05 ceiling, headroom for a re-quote) and `MCP_X402_SESSION_MAX_USD` (default $2.00/process) are soft limits in Node — not on-chain. At launch prices a $2.00 session covers ~40 of the priciest ($0.05) calls. |

**Do not** put main-wallet keys here. **Do not** pass the key as a tool argument.

### Verify MCP payment composition

```bash
cd packages/secondeye-mcp
npm install
MCP_X402_WALLET_KEY="$CANARY_WALLET_KEY" npm run test:mcp-pay
# expect HTTP 200, grantId, receipt.transaction, proof settlements > 0
```

## Tools

| Tool | When |
|------|------|
| `proof_bar` | Verify lounge live before spending |
| `patron_activity` | Have other agents bought here? Social proof |
| `read_laws` | Deterministic rules |
| `read_pricing` | First **15 min free**, then compounding session + services |
| `enter_lounge` | Start session — get `session.id` |
| `pause_and_route` | POST stuck state → condition routing |
| `github_mcp_401_fix` | Shortcut for PAT/401 → mcp-wiring ($0.05) |
| `order_service` | **Paid $0.01–$0.05 USDC** — claim-check, should-i-pay, context-compress, mcp-wiring, … (autopays when wallet set) |
| `leave_with_receipt` | Exit with itemized receipt |
| `fetch_catalog` | Full catalog |

Read tools (`proof_bar`, `patron_activity`, `read_menu`, `read_laws`, `read_pricing`, `fetch_catalog`) are registered `readOnlyHint:true` so trusted clients auto-approve them and the proof → pay funnel doesn't stall. `order_service` / `github_mcp_401_fix` are `idempotentHint:false, openWorldHint:true` and declare their USDC cost in the tool description + `outputSchema`. (MCP has no native "this tool costs money" annotation — annotations only drive confirmation prompts, never spending; the cost signal lives in the description and the payment is handled by the server bridge.)

## Agent flow

```
proof → laws → pricing → enter → pause_and_route → order_service → leave_with_receipt
```

## REST (no MCP)

- Front door: https://secondeyesai.com/api/bar
- llms.txt: https://secondeyesai.com/llms.txt
- Agent card: https://secondeyesai.com/.well-known/agent-card.json
- MCP discovery: https://secondeyesai.com/.well-known/mcp.json
- Hugging Face Space: https://huggingface.co/spaces/HellGateSys/secondeye-mcp-unblock

## Payment

Paid services + legacy taps return **HTTP 402**. Options:

- **MCP auto-pay:** set `MCP_X402_WALLET_KEY` on the MCP server — `order_service` completes payment inline.
- **REST manual:** pay USDC on Base → retry with `PAYMENT-SIGNATURE`.

## Publish to MCP Registry

```bash
npx @modelcontextprotocol/registry-cli login github
npx @modelcontextprotocol/registry-cli publish
```

(from repo root with `server.json`)

## AWS Agent Registry

Live record: `nJXn9fAgirGB` in registry `jaMy0SuApKYYJDTa` (APPROVED).

**Full publish playbook ($1 micro tap):** https://secondeyesai.com/api/bar/taps/aws-agent-registry-publish  
**Free summary:** [registry/packs/aws-agent-registry-publish.md](./registry/packs/aws-agent-registry-publish.md)  
**Automated:** `AWS_AGENT_REGISTRY_ID=jaMy0SuApKYYJDTa node scripts/publish-aws-registry.mjs`

## License

MIT
