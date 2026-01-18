# Nexus

> **The path from ERP to autonomy.**

## Vision

Nexus is an AI-driven Intelligence OS for mid-market enterprises trapped on antiquated ERP systems. It is the systematic path toward warehouse autonomy — eliminating human error from operations while empowering and upskilling the workforce.

This is how legacy businesses modernize with AI. Not by ripping out their ERPs, but by making them intelligent.

---

## Core Architecture

**ERP = Vault. MCP = Teller.**

The ERP remains the source of truth, preserved at all times. MCP provides controlled, read-only access — the teller that interfaces with the vault but never compromises it.

```
┌─────────────────────────────────────────────────────────┐
│                        NEXUS                            │
│                  Intelligence OS                        │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │   Claude    │  │   Pinecone  │  │   Dashboards    │ │
│  │ (AI Brain)  │  │ (Vector DB) │  │   & Alerts      │ │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘ │
│         │                │                   │          │
│         └────────────────┼───────────────────┘          │
│                          │                              │
│                    MCP Layer                            │
│              (Read-Only Connectors)                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│    ┌─────────┐    ┌─────────┐    ┌─────────┐          │
│    │  Sage   │    │   SAP   │    │Dynamics │   ...    │
│    │         │    │  B1     │    │ GP/NAV  │          │
│    └─────────┘    └─────────┘    └─────────┘          │
│                      ERPs (Vault)                       │
└─────────────────────────────────────────────────────────┘
```

---

## The Problem

Mid-market enterprises are data-rich but insight-poor. Their ERPs contain everything — transactions, inventory, customers, pricing — but extracting value requires:

- **Data silos** — Information trapped in disconnected systems
- **Manual reporting** — Hours spent pulling reports that should be instant
- **No real-time insights** — Decisions made on stale data
- **Integration nightmares** — Can't connect modern tools to legacy systems

The result: **Human error everywhere**

- Pricing mistakes erode margins
- Inventory errors cause stockouts and spoilage
- Data entry typos cascade through systems
- Missed opportunities lost to faster competitors
- Routing inefficiencies waste resources
- Shrinkage goes undetected
- Relentless pressure to scale with no way to keep up

---

## The Solution: Path to Autonomy

Nexus provides the systematic path from legacy ERP to autonomous operations:

### Stage 1: Visibility
See all your data in one place. Natural language queries across the entire business.

### Stage 2: Intelligence
AI surfaces anomalies, identifies patterns, and provides actionable insights proactively.

### Stage 3: Automation
Low-risk decisions automated. Humans handle exceptions and high-judgment calls.

### Stage 4: Autonomy
Full warehouse autonomy — autonomous vehicles, selectors, AI agents — coordinated by Nexus, with humans in supervisory roles.

**The principle:** Start with low-risk automation, earn trust through demonstrated reliability, expand the autonomy envelope incrementally.

---

## Capabilities

### Intelligence Layer (Claude-powered)

- **Answer questions** — Natural language queries across all business data
- **Surface anomalies** — Proactive alerts on unusual patterns, risks, opportunities
- **Automate workflows** — Take actions based on triggers and conditions
- **Generate reports** — Dashboards, summaries, forecasts on demand

### Vector Memory (Pinecone)

- ERP data embeddings for semantic search
- Document storage (PDFs, contracts, emails)
- Conversation history for context continuity
- Knowledge base (policies, procedures, tribal knowledge)
- Business operations context

### User Interfaces

- Chat interface for natural language interaction
- Dashboards with visual analytics and KPIs
- Proactive alerts and notifications
- Embedded in existing tools (Slack, Teams, email)

### Department Coverage

- **Executives** — Instant answers on business health
- **Operations** — Warehouse, purchasing, production management
- **Finance** — Controllers, accountants, AR/AP
- **Sales** — Account managers, customer service
- **Transportation/Routing** — Logistics optimization

---

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| AI | Claude (Anthropic) | Strong reasoning, tool use, transparency |
| Vector DB | Pinecone | Managed, scalable, proven |
| Connectors | MCP (Model Context Protocol) | Standard protocol for ERP access |
| Backend | Python | AI/ML ecosystem, flexibility |
| Cloud | AWS | Bedrock, Lambda, S3, enterprise-ready |
| Deployment | Flexible | On-prem, hybrid, or cloud based on customer security posture |

---

## Target Market

### Primary: Mid-Market Enterprises

Companies ignored by enterprise vendors but too complex for SMB tools:
- $10M - $500M revenue
- 50-500 employees
- Legacy ERP systems (Sage, SAP Business One, Dynamics, Infor)
- Warehouse/distribution operations

### First Customer: Produce Distribution

**ERP:** Produce Pro (SQL Server backend)
**Initial Access:** CSV exports (weekly pricing) → evolving to API
**Wedge Product:** PopQuote (pricing intelligence + automated quoting)

### Target ERPs (Priority Order)

1. Produce Pro (first connector)
2. Sage 100/300
3. SAP Business One
4. Microsoft Dynamics GP/NAV/Business Central

Industry-agnostic — the patterns work across any ERP.

---

## Deployment Models

Based on customer security posture:

| Model | When | Architecture |
|-------|------|--------------|
| Cloud SaaS | Standard security, no VPN restrictions | Nexus hosted, customer connects ERP |
| Hybrid | VPN-protected ERP | AI/Vector in cloud, MCP connectors on-prem |
| On-Prem | Strict data sovereignty requirements | Full deployment inside customer network |

---

## Go-to-Market Strategy

### The Wedge: PopQuote

PopQuote is a working MVP for pricing intelligence and automated quoting. It demonstrates immediate value:

- Price trend analysis
- Margin analysis
- Competitive intelligence
- Anomaly detection
- Instant accurate quotes

**Strategy:**
1. PopQuote wows client leadership with immediate value
2. Builds trust and demonstrates AI capability
3. Opens conversation for broader Nexus vision
4. Expands module by module, department by department

### Land and Expand

1. **Land** with PopQuote (pricing/quoting)
2. **Expand** to sales intelligence
3. **Expand** to inventory management
4. **Expand** to routing/transportation
5. **Expand** to full autonomous operations

---

## Values & Ethics

### Core Values

| Value | Meaning |
|-------|---------|
| **Clarity & Integrity** | Operate honestly, no hidden agendas |
| **Transparency** | AI decisions are explainable, never black boxes |
| **Data Sovereignty** | Customer owns their data, always |
| **Incremental Trust** | Earn autonomy through demonstrated reliability |
| **Partnership** | Long-term relationships, not transactions |

### Human-Centered Autonomy

**We do not work for or advocate for using AI to take humans' jobs.**

Our mission is to **empower and educate**. We don't just prepare the C-Suite — we prepare their staff for this change.

When autonomy eliminates tasks:
- **Upskill** — Train workers for higher-value roles
- **Redeploy** — Move to areas needing human judgment
- **Oversight** — Humans supervise and handle exceptions
- **Growth** — Automation enables growth, growth creates new roles

### Education Model

- **Change management** — Consulting alongside the platform
- **Self-service** — Documentation, videos, learning paths
- **Train-the-trainer** — Empower internal champions

---

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] MCP connector framework for ERP read-only access
- [ ] Vector pipeline: ingest → embed → store → retrieve
- [ ] Natural language query interface over business data
- [ ] Dashboard foundation with department-specific KPIs
- [ ] Real-time data synchronization capability
- [ ] Flexible deployment (cloud/hybrid/on-prem)
- [ ] Proactive anomaly detection and alerting
- [ ] Explainable AI decisions (transparency)

### Out of Scope (For Now)

- Write-back to ERP — Read-only only, humans write
- Physical automation hardware — Partner ecosystem handles this
- Enterprise (Fortune 500) — Mid-market focus
- Custom LLM training — Use Claude as-is

---

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Read-only ERP access | Preserve ERP as source of truth, build trust | Locked |
| Claude as LLM | Strong reasoning, tool use, Anthropic alignment | Locked |
| Pinecone for vectors | Managed, scalable, proven | Locked |
| AWS as cloud provider | Enterprise-ready, Bedrock integration | Locked |
| MCP for connectors | Standard protocol, future-proof | Locked |
| PopQuote as wedge | Proves value quickly, opens door to broader vision | Locked |
| Partner ecosystem for physical | Focus on intelligence layer, not hardware | Locked |

---

## Success Metrics

### PopQuote (Wedge)

- Client leadership is "wowed"
- Opens conversation for Nexus expansion
- Demonstrates pricing intelligence value

### Nexus (Platform)

- Time to insight: Minutes, not hours
- Human error reduction: Measurable decrease
- User adoption: All departments using system
- Customer expansion: Land → Expand pattern working

### Long-term (Autonomy)

- Autonomy ladder progression
- KPI improvements proven
- Workforce upskilled, not displaced

---

## Development Approach

See [SWARM.md](./SWARM.md) for the agentic swarm architecture:

- **Hierarchical** orchestration with Chief-of-Staff agent
- **Phase-based** agent squads (activated per phase)
- **Mandatory gates** with human review at every transition
- **Fully autonomous** between checkpoints

---

*Last updated: 2026-01-17 after initialization*
