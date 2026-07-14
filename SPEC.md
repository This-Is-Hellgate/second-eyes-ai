# Second Eyes — Specification and Action Plan (v2 rebuild)

The governing rulebook is the [x402 Foundation specification](https://github.com/x402-foundation/x402):
`specs/x402-specification-v2.md`, its transport specs (`specs/transports-v2/`), and its extension
specs (`specs/extensions/`). Where this document and that repository disagree, that repository wins.

This is the **side-by-side v2 rebuild** of Second Eyes, modeled on the proven Second Wind
gatekeeper. It runs alongside the live legacy stack (`functions/`, serving secondeyesai.com today)
and does not touch it. Cutover is an explicit, proven step — never a silent flip.

---

## 0. Architecture

**The gatekeeper is the official x402 SDK.** Serving runs as a Hono app on Cloudflare Workers
(`src/worker.js`, bundled by esbuild to `public/_worker.js`) using `@x402/hono` + `@x402/core` +
`@x402/evm` + `@x402/extensions`. The middleware verifies payment before the handler and settles
ONLY after the handler succeeds — a buyer is never charged for a failed check. Payment routes are
generated from the live D1 curated index (60-second isolate cache); the CDP facilitator
authenticates via CDP JWTs (`buildCdpAuthHeaders`).

This is the one move that retires the legacy stack's biggest liabilities in one stroke: the
hand-rolled x402/discovery code (and its PR #27 scar tissue), and the CDP resource-indexing gap
that x402#2821 flagged for `help-me`. The official `declareDiscoveryExtension` /
`declarePaymentIdentifierExtension` helpers build the wire shapes; we stop fighting the facilitator
by hand.

**Product model: a curated verification service — not a flat endpoint list.** The deliverable is
the **resolved check plus the judgment around it**: the verdict (stop / preserve / continue), the
guidance (the editorial voice), and the routing graph (how doors compose — `help-me` →
`schema-repair` / `context-pressure` / `should-i-pay`, each edge carrying its one-line WHY). D1
holds the curated index and the graph (`items` + `edges`, `migrations/0001_curation.sql`) — the
graph is the moat, first-class data. **Free surfaces carry stubs only**; the self-test fails
structurally if guidance or graph data leaks onto a free surface.

**Compute layer: Cloudflare Workers AI.** This is the substantive divergence from Second Wind
(which uses AWS Bedrock). Doors are one of four `invoke_kind`s:

| invoke_kind | method | behavior |
| --- | --- | --- |
| `verdict` | POST | deterministic worker logic (`src/lib/checks.js`) — same state ⇒ same verdict |
| `workersai` | POST | Cloudflare Workers AI (`env.AI`, `invoke_key` = model id) — transcribe/extract |
| `resolve` | GET | pure resolved guidance + composition (no further call) |
| `r2` | GET `/artifact` | deliberate secondary artifact fetch (`env.SE_MEDIA`), same x402 gate |

**Network is config, not a constant.** The first proof of the new gatekeeper runs **Base Sepolia
(`eip155:84532`)** with valueless test USDC via the public `x402.org` facilitator — real on-chain
verify → settle at zero cost. Promotion to Base **mainnet** (`eip155:8453`, where the legacy site
already settles) is an env swap (`X402_NETWORK`, `X402_FACILITATOR_URL` → CDP with JWT, mainnet
`payTo`). New code takes no real money until the conformance suite is green on a live preview.

**Side-by-side + cutover.** During the rebuild the new worker is NOT deployed: `public/_worker.js`
is gitignored and unbuilt, so Pages keeps serving the legacy `functions/`. Cutover is a deliberate,
gated step: build `_worker.js`, fold `wrangler.new.toml` into `wrangler.toml`, and ship the full
`/api/bar/*` → new-route compatibility map so existing paying agents keep working. `_worker.js`
takes precedence on Pages; the legacy handlers go inert the moment it deploys.

---

## 1. Conformance status

Proof is machine-checked by `scripts/selftest.mjs`, which validates emitted objects against JSON
Schemas transcribed from the spec's field tables (`scripts/spec-schemas.mjs`) and builds discovery
extensions with the official `@x402/extensions` helper.

| Rulebook area | Status | Proof |
| --- | --- | --- |
| §8 discovery resources document | Scaffolded | selftest: `/v2/x402/discovery/resources` validates §8.1/§8.3 schema |
| §5.1.2 PaymentRequirements (accepts[]) | Scaffolded | selftest: every accepts[0] validates §5.1.2 |
| §5.1.2 Extensions info+schema rule | Scaffolded | selftest: bazaar extension validates ExtensionsSchema |
| §5.1 PaymentRequired 402 / §5.3 Settlement | Pending | emitted by the SDK middleware; proven by a worker-selftest end-to-end (TODO) |
| §7.1 facilitator verify/settle body | Pending | SDK `HTTPFacilitatorClient`; proven at first Sepolia settle |
| §10 replay protection | Structural | UNIQUE `idx_payments_idem` refuses a second charge (`migrations/0002_ledger.sql`) |
| §11 CAIP-2 networks, atomic units | Scaffolded | `networks.js` CAIP-2 ids; amounts in USDC micros as strings |
| Extension: `bazaar` | Scaffolded | built by official `declareDiscoveryExtension` |
| Extension: `payment-identifier` | Scaffolded | declared `{required:false}` via official helper |

---

## 2. Action plan

| # | Step | Gate to advance | Status |
| --- | --- | --- | --- |
| 0 | Scaffold the gatekeeper side-by-side | src/ worker + libs, migrations, selftest, SPEC present; legacy untouched; `_worker.js` gitignored | **DONE** |
| 1 | Green the conformance suite | `npm install` && `npm run selftest` passes; `npm run build:worker` bundles clean | Next |
| 2 | Seed the doors | The legacy verification doors written as `items` + `edges` (names-are-symptoms), each field-valid; Mike approves the set | Blocked on 1 |
| 3 | Sepolia proof of the money path | Preview deploy on `eip155:84532`; canary purchase with a throwaway wallet via the official client — real verify → settle, valueless USDC | Blocked on 2 |
| 4 | Legacy-compat map | Full `/api/bar/*` → new-route redirects/aliases so existing paying agents don't break at cutover; covered by the selftest | Blocked on 3 |
| 5 | Mainnet promotion + cutover | Env swap to `eip155:8453` + CDP + mainnet payTo; build & commit `_worker.js`; fold `wrangler.new.toml` in; canary with real cents | Blocked on 4 |
| 6 | Get discovered | Facilitator indexes the resources (`EXTENSION-RESPONSES` bazaar `success`); resubmit to x402scan — closes x402#2821 | Blocked on 5 |

---

## 3. Standing rules

1. **The x402 Foundation repository is the rulebook.** Use its official packages; never hand-roll
   what they ship helpers for.
2. **Nothing rides the wire unless a downstream role consumes it.** Protocol surfaces carry
   spec-defined fields only; guidance lives in the paid body and documentation.
3. **The curated index is law after publish.** Writing an item `live` (with its edges) is the act
   of publishing; live changes are deliberate writes with a version bump and new content hash.
4. **No production store writes (D1, KV, R2) without Mike's explicit approval.** None. This
   includes provisioning the curation D1 and applying migrations to it.
5. **Price ceiling: $1.00 USDC per door.** A door is one specific check an agent needs.
6. **Plain names only.** No metaphor vocabulary (`bar`, `lounge`, `patron`, `tab`, …) on any
   agent-facing surface. The selftest greps for banned words and fails on a hit.
7. **The test suite encodes the spec, not the implementation.** Any conformance fix lands with a
   check proven to fail the flawed version.
8. **Curation never leaks free.** Free surfaces carry stubs only — no guidance, no graph. The
   selftest enforces this structurally.
9. **Names are symptoms, not taxonomy.** An item's `name` is the failure in the agent's own words
   (3-5 plain words, no hyphens, never a slug echo — "I am looping", "should I pay this"); the
   `slug` carries the taxonomy (`loop-detect`, `should-i-pay`).
10. **The live site is sacred until cutover.** The rebuild is side-by-side; `functions/` keeps
    serving real paying agents until step 5 is proven.
