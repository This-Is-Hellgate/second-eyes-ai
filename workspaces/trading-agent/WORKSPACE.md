# Trading Agent — workspace context

This workspace is **not** part of Second Eye AI. It is a separate agent domain for governed trading automation research and execution design.

## Boundaries

- Do not merge this workspace into the Second Eye review queue or D1 ontology.
- Do not deploy anything here via the `second-eyes-ai` Cloudflare Pages project.
- Treat exchange credentials, API keys, and live capital as out-of-scope until explicitly authorized in a task.

## Agent model (same law as the parent system)

1. **Workspace context** — this file; every agent in this workspace reads it first.
2. **Task layer** — structured tasks with title, description, acceptance criteria, explicit related-context links.
3. **Snapshots** — frozen JSON assignment packages at queue time (workspace + task + skills + related tasks).
4. **Skills** — resolutions written back as reusable, explicitly attached skills (join table, no similarity search).
5. **Comments** — in-task streaming updates as working memory.
6. **Activity log** — append-only log of every state change.

## Core principle

No vector embeddings. No similarity search. Pure relationship tables with explicit connections.

## Domain focus

Automated trading systems: market data ingestion, signal generation, risk gates, execution, audit trails. Agents supply candidates and analysis; human gates what runs with real money.
