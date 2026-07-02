# Second Eyes Architecture Specification

_Updated: 2026-07-02_
_Status: canonical product and trust architecture_

## Purpose

Second Eyes is an agent-centric workspace and capability network. Reputable agents can improve reliability, skill, efficiency, and scope while remaining under the authority of their owners and institutions.

Agents may run on any framework or infrastructure. Second Eyes does not require runtime migration. It provides credential-aware services, tools, context, execution controls, and evidence that companies and people can elect to use.

## Cascading Authority Model

Authority is evaluated from the top down. A lower level cannot override a higher one.

1. **Structural law** — tenant isolation, authenticated identity, consent, auditability, revocation, and legal constraints.
2. **Trusted institution registry** — the institutions accepted as credential issuers.
3. **Institution policy** — owner contacts, approval channels, budgets, data boundaries, and operational policy.
4. **Credentialed agent** — a verifiable agent identity issued or endorsed by a listed institution.
5. **Active mission mandate** — the current purpose, scope, expiry, budget, and approval conditions.
6. **Framework adapter** — MCP, A2A, AgentCore, LangGraph, CrewAI, custom runtimes, or another supported interface.
7. **Scoped capability profile** — only the tools, data, and workspace services relevant to the institution and mission.
8. **Action and evidence** — every material operation produces attributable status, cost, approval, and outcome records.

An agent is admitted only when its institutional credential and active mission are valid. Payment alone never grants operational authority.

## Admission and Disclosure

The public surface exposes only enough information to identify Second Eyes and explain the credential requirement. Operational catalogues, routes, policies, and tenant context are disclosed after admission and reduced to the caller's mission scope.

At ingress, Second Eyes verifies:

- credential issuer is a listed institution;
- agent credential is valid and not revoked;
- mission mandate is current and bound to that agent and institution;
- requested framework and capability are permitted;
- budget, quota, and owner-approval requirements are satisfied.

Verification occurs again at material action boundaries. Session admission is not ambient authority.

## Owner Control and Structural Limits

Owners decide how much autonomy to grant their agents. They may authorize persistent or temporary agents, broad or narrow missions, and automatic or human-approved actions.

Owners cannot disable structural law, tenant isolation, required evidence, revocation, or legally required controls. High-impact or irreversible actions require an approval channel the agent cannot forge.

## Agent Workspace Services

Second Eyes can provide:

- mission-scoped tool catalogues;
- datasets and controlled data access;
- media submission and multimodal transcription;
- tables, wikis, retrieval systems, and owner-supplied context;
- reproducible compute and managed execution environments;
- permission requests for temporary sub-agent swarms;
- workflow findings that agents can present immediately to owners for approval;
- complete owner-visible activity, spending, approval, and outcome evidence.

The workspace is agent-centric and owner-transparent. Second Eyes services can be used independently; customers are not required to adopt a single orchestration platform.

## Protocol Roles

Protocols are adapters to the authority model, not substitutes for it.

| Protocol | Role |
|---|---|
| MCP / A2A | Tool and agent interoperability |
| x402 v2 | Machine settlement and payment receipts |
| AP2 | Signed intent, cart, and payment mandates; owner consent and commerce authorization |
| ERC-8004 | Optional external identity, reputation, and validation bridge; not the institutional source of truth |
| AWS IAM | AWS resource authorization and downstream policy enforcement |
| Verifiable credentials / workload identity | Institution-to-agent identity and mission claims |

ERC-8004 is currently a draft standard. Its validation registry records validation evidence; it is not Second Eyes' financial ledger.

## Payment Is Not Authority

The x402 handshake is implemented and has settled external payments on Base. It proves that a caller satisfied a payment requirement. It does not prove the caller's employer, mission, authorization, or trustworthiness.

Payment is evaluated after admission and scope resolution where a protected capability requires settlement. AP2 and other payment mandates express commercial consent; they do not replace institutional credentials.

## AWS Pilot

AWS is the first institutional capability domain because Second Eyes has an approved AWS Agent Registry record and AWS provides a broad open-source agent and infrastructure ecosystem.

The pilot architecture is:

1. Cloudflare gateway receives the request and limits unauthenticated crawlers.
2. A signed credential resolves institution, agent, framework, active mission, scope, budget, and expiry.
3. The service issues a short-lived mission session.
4. The catalogue is reduced to mission-relevant AWS capabilities.
5. AWS IAM enforces actual AWS resource permissions.
6. AgentCore services provide managed execution, browser, code-interpreter, identity, observability, and payment-session integrations where appropriate.
7. Every action and approval is visible to the owner.

Initial open-source inputs include AWS CDK, CloudFormation templates, Lambda IAM policy examples, SageMaker Distribution, and the Bedrock AgentCore SDK. Samples are evaluated and hardened before production use; they are not exposed wholesale.

## Referral and Execution Ledger

Second Eyes records two distinct evidence streams:

1. **Discovery evidence** — source directory, client/framework signal, requested public resource, timestamp, and outcome, including unpaid 402 challenges.
2. **Execution evidence** — institution, credentialed agent, mission, framework, selected capability, approval, cost, payment transaction, request identifier, and outcome.

Task content is not retained unless the institution explicitly authorizes it. Evidence must support owner transparency without publishing tenant operations.

## Current State

- x402 v2 settlement on Base is live and externally proven.
- `@secondeyes/mcp-unblock@1.2.6` is live on npm; `1.1.x` is deprecated (x402 v1 clients); `1.0.x` is free-reads-only legacy.
- Existing `1.x` MCP tool identifiers remain compatibility aliases while public descriptions use technical workflow language.
- An AWS Agent Registry record is approved; its descriptor requires synchronization to the current release.
- Credential admission, mission sessions, referral attribution, AP2 adapters, and ERC-8004 adapters are planned implementation phases.

This file defines product authority. Payment configuration, directory listings, and legacy route names cannot override it.
