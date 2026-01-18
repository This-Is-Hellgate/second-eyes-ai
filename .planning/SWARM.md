# Nexus Agentic Swarm Architecture

## Philosophy

Fully autonomous agents between checkpoints, with mandatory human review at every major gate. The swarm handles research, planning, development, and documentation — but decisions require human approval.

**Autonomy Principle:** Agents run until checkpoint with no interruptions. Trust is earned through demonstrated reliability at each gate.

---

## Top-Level Structure: Hierarchical

### Orchestrator / Chief-of-Staff Agent

**Job:** Owns the roadmap, assigns tasks, enforces stop points, merges outputs, prevents scope creep.

**Rules:**
- No agent changes architecture without an "Architecture Gate" review
- No build work without success criteria defined
- Every deliverable has: assumptions, risks, tests, next actions

---

## Agent Memory Architecture

Agents share context through multiple mechanisms:

1. **Document-based** — Agents write/read from `.planning/` files
2. **Vector memory** — Shared vector DB for agent context continuity
3. **Handoff summaries** — Structured handoffs between agent phases

---

## Phase-Based Agent Squads

Agents are activated/deactivated per phase. Each phase has a clear goal, dedicated agents, and a mandatory review gate.

---

## Phase 0 — Thesis & Scope

**Duration:** 2–3 days
**Goal:** Pick ONE wedge and ONE ICP + define success metrics

### Agents

| Agent | Responsibility |
|-------|----------------|
| **ICP & Workflow Agent** | Map target customer (produce/HVAC/etc), understand daily operations |
| **ROI / Pricing Agent** | Define KPIs, build gainshare/pricing model |
| **Competitive Intel Agent** | Research incumbents, identify where they're slow |
| **Risk & Compliance Agent** | Assess liability, audit requirements |

### Gate 0 — Stop for Review

- [ ] ICP chosen
- [ ] 1 workflow chosen
- [ ] 1 measurable KPI chosen
- [ ] Pilot spec drafted (1 page)

---

## Phase 1 — Architecture & Stack

**Duration:** 3–5 days
**Goal:** Design the "thin slice" system that can ship

### Agents

| Agent | Responsibility |
|-------|----------------|
| **Systems Architect Agent** | Reference architecture, technology stack decisions |
| **Enterprise Integration Agent** | ERP/WMS/TMS connectors, CDC vs polling strategy |
| **Data/Memory Agent** | Vector schema, hybrid search, retrieval evaluation |
| **Security & Permissions Agent** | MCP tool scopes, audit logging |

### Gate 1 — Stop for Review

- [ ] "Thin-slice" architecture diagram
- [ ] Tool registry list (read-only first)
- [ ] Data flows + logging plan
- [ ] Build vs buy decisions locked

---

## Phase 2 — Prototype

**Duration:** 10–14 days
**Goal:** Working demo on historical data + "shadow mode"

### Agents

| Agent | Responsibility |
|-------|----------------|
| **Backend Dev Agent** | APIs + tool calls implementation |
| **Retrieval Agent** | Indexing, chunking, evaluation harness |
| **Optimization Agent** | Resequence / local search / OR-tools baseline |
| **Frontend/UX Agent** | Dispatcher workflow UI |

### Gate 2 — Stop for Review

- [ ] Demo runs end-to-end
- [ ] "Why" explanations shown (transparency)
- [ ] Replay yesterday's routes + compare outcomes
- [ ] Error budget + failure modes listed

---

## Phase 3 — Pilot

**Duration:** 4–8 weeks
**Goal:** Run alongside real dispatch, prove KPI

### Agents

| Agent | Responsibility |
|-------|----------------|
| **Pilot Operator Agent** | Daily feedback loop, change management |
| **Observability Agent** | Metrics, drift detection, latency, reliability |
| **Override Learning Agent** | Capture human overrides + outcomes for learning |
| **Integration Hardening Agent** | Edge cases, data reconciliation |

### Gate 3 — Stop for Review

- [ ] KPI movement proven (even modest)
- [ ] Top 10 exceptions cataloged + handled
- [ ] "Autonomy ladder" plan agreed with customer

---

## Phase 4 — Productization

**Duration:** Ongoing
**Goal:** Turn pilot into repeatable product

### Agents

| Agent | Responsibility |
|-------|----------------|
| **Platform Agent** | Tool SDK, connectors, multi-tenant decisions |
| **Go-to-Market Agent** | Case study, pitch deck, packaging |
| **QA / Reliability Agent** | Test suites, rollback procedures, chaos testing |
| **Security/Compliance Agent** | SOC2 path, audit exports |

### Gate 4 — Stop for Review

- [ ] Repeatable onboarding checklist
- [ ] Connector template
- [ ] Pricing locked
- [ ] "Autonomy policy" framework defined

---

## Gate Summary

| Gate | Phase | Key Deliverables |
|------|-------|------------------|
| Gate 0 | Thesis & Scope | ICP, workflow, KPI, pilot spec |
| Gate 1 | Architecture | Thin-slice diagram, tool registry, data flows |
| Gate 2 | Prototype | E2E demo, explanations, error budget |
| Gate 3 | Pilot | KPI proof, exceptions handled, autonomy plan |
| Gate 4 | Productization | Onboarding checklist, connector template, pricing |

---

## Cross-Cutting Principles

1. **No architecture changes without Architecture Gate review**
2. **No build work without success criteria defined**
3. **Every deliverable includes:** assumptions, risks, tests, next actions
4. **Transparency:** AI decisions must be explainable
5. **Human-in-the-loop:** Autonomy is earned, not assumed

---

*Last updated: 2026-01-17 after initialization*
