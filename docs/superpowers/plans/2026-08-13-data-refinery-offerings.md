# Data Refinery Offerings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing `transcribe` and `extract` products with two agent-facing x402 offerings: multimodal Content Analysis for text-only agents and Paper-to-Code implementation generation for research papers.

**Architecture:** Keep the existing x402 verification/settlement spine and Workers AI/R2/D1 infrastructure. Replace the public one-word product slugs and discovery contracts, while using hidden compatibility aliases for the old URLs. Content Analysis may use an internal transcript/markdown representation but never sells or returns verbatim transcription; Paper-to-Code uses a staged paper parse → implementation plan → repository-generation pipeline and returns a machine-readable repository package.

**Tech Stack:** Cloudflare Pages Functions, Workers AI, R2, D1, x402 v2, Node 22 self-tests.

## Global Constraints

- Confirmed public products in this change are only: Content Analysis and Paper-to-Code.
- Public paid slugs must be descriptive; do not advertise `transcribe` or `extract` as products.
- Content Analysis serves text-to-text agents that cannot natively consume video/audio/PDF inputs.
- Content Analysis returns transformative analysis, not a verbatim transcript.
- Paper-to-Code accepts a research-paper URL and produces an implementation-ready code repository package.
- Preserve the existing x402 v2 payment spine and Bazaar metadata rules.
- Do not settle payment when deterministic validation fails.
- Old `/transcribe` and `/extract` routes may remain only as non-discoverable compatibility redirects/aliases.

---

### Task 1: Lock the public refinery contract

**Files:**
- Create: `test/refinery-offerings.test.mjs`
- Modify: `.github/workflows/discovery-check.yml`

**Interfaces:**
- Consumes: `buildOpenApi(origin, env)` from `functions/_lib/discovery.js`.
- Produces: CI assertions for the two new paths and for removal of old one-word product paths from discovery.

- [ ] Write failing assertions for `/api/bar/x402/analyze-video-audio-and-pdfs` and `/api/bar/x402/turn-paper-into-code`.
- [ ] Assert `/api/bar/x402/transcribe` and `/api/bar/x402/extract` are not advertised.
- [ ] Assert the new summaries describe the actual buyer outcome.
- [ ] Wire the self-test into Discovery consistency CI.
- [ ] Run CI and confirm RED on the missing new paths.

### Task 2: Build Content Analysis

**Files:**
- Create: `functions/api/bar/x402/analyze-video-audio-and-pdfs.js`
- Modify: `functions/_lib/llm-workersai.js`
- Replace: `functions/api/bar/x402/transcribe.js` with a non-discoverable compatibility alias.

**Interfaces:**
- Input: `{ url, kind?, duration_seconds? }` via GET query or POST JSON.
- Output: language, media kind, executive summary, themes, key claims/data points, entities, relationships, questions/answers, and evidence-only attestation.

- [ ] Keep the internal ASR/PDF-to-Markdown stage for grounding.
- [ ] Generate transformative analysis only; omit verbatim transcript from paid output.
- [ ] Validate analysis against the internal source representation before settlement.
- [ ] Keep URL/size/SSRF gates and no-charge-on-failure semantics.

### Task 3: Build Paper-to-Code

**Files:**
- Create: `functions/api/bar/x402/turn-paper-into-code.js`
- Modify: `functions/_lib/llm-workersai.js`
- Create: `functions/_lib/paper-code-validate.js`
- Replace: `functions/api/bar/x402/extract.js` with a non-discoverable compatibility alias.

**Interfaces:**
- Input: `{ paper_url, target_language?, framework?, repository_name? }` via GET query or POST JSON.
- Output: repository metadata, implementation plan, assumptions, dependencies, file array (`path`, `purpose`, `content`), tests, and source-grounding notes.

- [ ] Fetch/convert the paper with existing safe document infrastructure.
- [ ] Stage 1: derive implementation plan/architecture from the paper.
- [ ] Stage 2: derive algorithms, equations, dependencies, assumptions, and test requirements.
- [ ] Stage 3: generate a bounded repository package from the staged artifacts.
- [ ] Deterministically validate required repository files, unique safe paths, non-empty code, tests, and implementation notes before settlement.

### Task 4: Replace discovery and registry-facing product metadata

**Files:**
- Modify: `functions/_lib/discovery.js`
- Modify: `functions/_lib/mcp-facade.js` only where public tool/catalog language references the replaced products.
- Modify any static discovery docs/manifests that explicitly advertise `transcribe` or `extract`.

**Interfaces:**
- Public slugs: `analyze-video-audio-and-pdfs`, `turn-paper-into-code`.
- Legacy slugs: compatibility only, never surfaced in OpenAPI/x402 resource discovery.

- [ ] Replace static input definitions and paid-door entries.
- [ ] Update guidance/decision-tree links.
- [ ] Ensure Bazaar descriptions sell the resource outcome, not an internal function name.
- [ ] Run discovery consistency and refinery self-tests.

### Task 5: Full verification and merge

- [ ] Run all PR-triggered Discovery consistency checks.
- [ ] Confirm x402 v2/Bazaar tests remain green.
- [ ] Review PR diff for accidental legacy product advertising.
- [ ] Merge only after CI is green.
