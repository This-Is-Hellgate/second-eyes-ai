# Nikolexx / AI-Trading-Bot-From-Data-to-Money

**URL:** https://github.com/Nikolexx/AI-Trading-Bot-From-Data-to-Money  
**Parked in:** `workspaces/trading-agent/`  
**Second Eye index:** No — trading domain, not AI UX/UI design research

## What it claims

Automated crypto trading on Bitget: real-time data, neural forecast model, buy/sell signal execution.

## Triage (do not run the README install path)

| Signal | Finding |
|--------|---------|
| Zip funnel | README `git clone`, `pip install`, and `python` commands all point at the same `.zip` on GitHub raw |
| Auditable source | Repo tree is mostly README + demo video + nonsense folder (`severish/`) — not a normal Python package layout |
| Mission (Second Eye) | Off-mission |
| Mission (trading workspace) | Conceptually relevant; **implementation not trustworthy as-is** |

## Why keep the reference

Useful as a **feeder-shaped example** of what an agent might surface, and why human gating matters before anything touches an exchange API.

## If pursuing trading agents

Look for repos with:

- real source tree (`src/`, tests, `requirements.txt` or `pyproject.toml` — not zip URLs)
- documented backtest methodology
- explicit risk limits and paper-trading mode
- no obfuscated landing pages or raw zip install instructions
