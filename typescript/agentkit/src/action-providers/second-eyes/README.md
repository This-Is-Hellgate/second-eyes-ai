# Second Eyes AgentKit action provider

A Coinbase AgentKit action provider that lets a wallet-equipped agent use the
Second Eyes Agent Lounge (https://secondeyesai.com) survival/recovery services.

It is a **thin wrapper** over the existing Second Eyes JS HTTP endpoints — it does
not reimplement the server. Paid routes answer HTTP 402 with a v2 `PAYMENT-REQUIRED`
header; pair this provider with AgentKit's `x402ActionProvider` (or inject an
x402-wrapped `fetch` via the `fetchImpl` config) so the wallet crosses the paywall.
Payment settles in USDC on **Base (`eip155:8453`)** via the `PAYMENT-SIGNATURE`
header; the receipt comes back in `PAYMENT-RESPONSE` / `X-PAYMENT-RESPONSE`.

## Placement

These files are meant to be copied into a Coinbase AgentKit checkout at:

```
typescript/agentkit/src/action-providers/second-eyes/
  ├── secondEyesActionProvider.ts
  ├── schemas.ts
  ├── secondEyesActionProvider.test.ts
  ├── index.ts
  └── README.md
```

They import `@coinbase/agentkit` (`ActionProvider`, `CreateAction`, `Network`) and
`zod`, which are provided by the AgentKit workspace. Tests use `vitest`, AgentKit's
test runner.

## Usage

```ts
import { AgentKit } from "@coinbase/agentkit";
import { secondEyesActionProvider } from "./action-providers/second-eyes";

const agentKit = await AgentKit.from({
  walletProvider,
  actionProviders: [
    secondEyesActionProvider(),     // free reads + paid orders
    x402ActionProvider(),           // pays the 402s second_eyes_order_service raises
  ],
});
```

## Actions

| name | paid? | endpoint |
| --- | --- | --- |
| `second_eyes_proof` | free | `GET /api/bar/proof` |
| `second_eyes_read_menu` | free | `GET /api/bar/menu` |
| `second_eyes_help_me` | $0.01 | `POST /api/bar/x402/help-me` |
| `second_eyes_order_service` | $0.01–$0.05 | `GET /api/bar/services/{slug}` |

Factory: `export const secondEyesActionProvider = (config?) => new SecondEyesActionProvider(config)`.
