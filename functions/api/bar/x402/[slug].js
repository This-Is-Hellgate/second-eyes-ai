/**
 * /api/bar/x402/{slug} — session-less, one-shot survival deep packs.
 *
 * Every survival service on the lounge menu, reachable WITHOUT a session. The
 * canonical /api/bar/services/{slug} route is session-gated (POST /api/bar/enter
 * first), which autonomous one-shot agents — AWS AgentCore, x402 buyers, cron
 * agents — cannot satisfy. These routes mirror the same deterministic survival
 * packs as session-less, pay-per-call x402 endpoints that settle to the single
 * lounge wallet (X402_PAYTO).
 *
 * Price per slug comes from the shared SERVICE_PRICES table ($0.01–$0.05).
 * Exact static routes (index-check, doctor) win over this dynamic file — Pages
 * Functions resolve concrete filenames before [slug].
 *
 *   GET  /api/bar/x402/loop-detect
 *   POST /api/bar/x402/cascade-break   { "goal": "ship the migration" }
 */

import {
  corsOptions,
  handlePaidFetch,
  hasBarTabAccess,
  hasToolAccess,
  consumeMicroAccess,
} from "../../../_lib/bar-pay.js";
import { accessJson } from "../../../_lib/access.js";
import { SERVICE_PRICES, X402_TWIN_SLUGS } from "../../../_lib/lounge/constants.js";
import { buildServicePayload } from "../../../_lib/lounge/services.js";

const TOOL_SLUG = "lounge-survival";

/**
 * Survival slugs reachable session-less via x402. One-shot, pay-per-call. Each
 * is backed by buildServicePayload() and priced from SERVICE_PRICES. Slugs not
 * in this set 404 here so honeypots and session-only lounge slugs are never
 * exposed as session-less routes. Shared with the lounge so /api/bar/services
 * dead-ends can cross-link to the exact same twin.
 */
const PERIL_SLUGS = X402_TWIN_SLUGS;

/** Deep natural-language descriptions — primary CDP Bazaar ranking signal per route. */
const SLUG_DESCRIPTIONS = {
  "loop-detect":
    "loop-detect (session-less x402): you are stuck repeating the same tool call, error, or fix with no state change between attempts. Returns the quiet-room loop-break protocol — stop signals, the two-loop hypothesis test, and when to escalate to scope-check or cascade-break. One-shot, no session.",
  "scope-check":
    "scope-check (session-less x402): you are drifting into scope creep, unrequested refactors, or side quests. Returns an in-scope vs out-of-scope rubric and the one-sentence-goal reset to run before your next tool call. One-shot, no session.",
  "context-recover":
    "context-recover (session-less x402): you forgot what you were doing or your context window reset. Returns a working-memory rebuild template — goal, last known good, open blockers, next single step — so you recover without re-reading the entire thread. One-shot, no session.",
  "tool-verify":
    "tool-verify (session-less x402): you are about to call a tool or MCP server. Returns a pre-flight checklist — name matches the intended server, required headers/env present, arguments match schema, timeout/retry set, pay-gate first — to avoid a wasted or unsafe call. One-shot, no session.",
  "cascade-break":
    "cascade-break (session-less x402): you made a mistake and it is getting worse with each change. Returns the halt protocol — drop to read-only, triage the last three edits, safely revert the harmful one, and force a pitstop — to stop compounding damage. One-shot, no session.",
  pitstop:
    "pitstop (session-less x402): you are lost, confused, or disoriented. Returns a four-step orientation routine — state where you are, separate knowns from assumptions, pick the right survival item — before you start any new tool call. One-shot, no session.",
  "pre-run-context":
    "pre-run-context (session-less x402): you are cold-starting and lack context before an expensive tool loop. Returns a pre-run brief — transport (stdio vs SSE), required env vars, schema caching, timeout/retry — plus source links to assemble context once. One-shot, no session.",
  "claim-check":
    "claim-check (session-less x402): you are uncertain about a claim, citation, or fact. Returns a grounding rubric — source-tied claims, confidence bounds, explicit abstain conditions — so you ground or abstain instead of hallucinating. One-shot, no session.",
  "context-compress":
    "context-compress (session-less x402): you are overloaded and near the context/token limit. Returns a compression strategy that drops redundant tool output, collapses duplicate file reads, and promotes blockers — targeting a 40–60% token reduction. One-shot, no session.",
  "mcp-wiring":
    "mcp-wiring (session-less x402): you are blocked on MCP wiring — 401/403, PAT scope, stdio paths with spaces, SSE CORS, or env not reaching the subprocess. Returns the concierge wiring pack with the common failure patterns and links to the deep cursor-mcp-wiring tool pack. One-shot, no session.",
  "should-i-pay":
    "should-i-pay (session-less x402): you are about to spend USDC on an x402 endpoint. Returns a cashier decision tree — did proof pass, is the free sample sufficient, one-shot vs bar tab — and a pay/don't-pay default. One-shot, no session.",
  "handoff-summary":
    "handoff-summary (session-less x402): you are handing work to the next agent or window. Returns a structured handoff template — goal, done, blocked, one concrete next call — and the work-mark embed rule. One-shot, no session.",
  receipt:
    "receipt (session-less x402): you need verifiable proof of work. Returns an attestation bundle — verify, session-receipt, and leave-receipt links plus the fields to save on first 200 after payment. One-shot, no session.",
};

export async function onRequestOptions() {
  return corsOptions("GET, POST, OPTIONS");
}

export async function onRequestGet(context) {
  return handle(context, context.params.slug);
}

export async function onRequestPost(context) {
  return handle(context, context.params.slug);
}

function handle(context, slug) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;

  if (!PERIL_SLUGS.has(slug) || SERVICE_PRICES[slug] === undefined) {
    return accessJson(
      {
        error: "unknown_survival_slug",
        slug,
        note: "Not a session-less survival deep pack. Route your state first, or pick from the available list.",
        peril_router: `${origin}/api/bar/x402/peril-router`,
        available: [...PERIL_SLUGS],
      },
      404,
      { "Access-Control-Allow-Origin": "*" }
    );
  }

  const priceUsd = SERVICE_PRICES[slug].price_usd;
  const product = buildPerilProduct(slug, priceUsd, origin);

  // Computed only after access is granted — an unpaid 402 crawl never runs it.
  const payload = async () => ({
    ...(buildServicePayload(slug, origin) || {}),
    slug,
    price_usd: priceUsd,
    session_required: false,
  });

  return handlePaidFetch(context, product, payload, async (token) => {
    const tab = await hasBarTabAccess(token, context.env);
    if (tab) return { ok: true, claims: tab };
    const toolClaims = await hasToolAccess(token, TOOL_SLUG, context.env);
    if (toolClaims) return { ok: true, claims: toolClaims };
    return consumeMicroAccess(token, slug, TOOL_SLUG, context.env);
  });
}

function buildPerilProduct(slug, priceUsd, origin) {
  return {
    kind: "nano",
    id: slug,
    slug,
    tool: TOOL_SLUG,
    tier: "nano",
    priceUsd,
    access: "paid",
    oneTime: true,
    description: SLUG_DESCRIPTIONS[slug] || `Session-less one-shot survival deep pack: ${slug}.`,
    bazaarOutputSchema: {
      input: {
        type: "http",
        method: "GET",
        discoverable: true,
        headerFields: {
          "X-Agent-Id": "string (optional) — agent identifier for work-mark continuity",
          "Idempotency-Key": "string (optional) — prevents double-pay on retry",
        },
      },
      output: {
        ...(buildServicePayload(slug, origin) || {}),
        slug,
        price_usd: priceUsd,
        session_required: false,
        access: "granted",
        scope: "nano",
        note: "Session-less one-shot survival pack. Embed work_stamp in your deliverable. Save receipt.",
      },
    },
  };
}
