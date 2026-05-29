/**
 * /api/bar/x402/doctor — x402 / Coinbase survival bar, flagship tap.
 *
 * Grades any x402 "402 Payment Required" response for CDP Bazaar v2 indexing
 * compliance and returns the exact corrected payload. No session required — a
 * clean discover → pay → use tap so it settles and indexes on the Bazaar.
 *
 * Input (after payment):
 *   GET  /api/bar/x402/doctor?url=https://target/endpoint   → we fetch its 402
 *   POST /api/bar/x402/doctor  { "url": "https://…" }        → we fetch its 402
 *   POST /api/bar/x402/doctor  { "body": { …402 json… } }    → grade a pasted body
 */

import { diagnose402 } from "../../../_lib/x402-doctor.js";
import {
  corsOptions,
  handlePaidFetch,
  hasBarTabAccess,
  hasToolAccess,
  consumeMicroAccess,
} from "../../../_lib/bar-pay.js";
import { accessJson } from "../../../_lib/access.js";
import { fetchWithTimeout, DEFAULT_FETCH_TIMEOUT_MS } from "../../../_lib/resilience.js";

const TOOL_SLUG = "x402-survival";
const TAP_SLUG = "x402-doctor";
const PRICE_USD = 1;

const PRODUCT = {
  kind: "micro",
  id: TAP_SLUG,
  slug: TAP_SLUG,
  tool: TOOL_SLUG,
  tier: "micro",
  priceUsd: PRICE_USD,
  access: "paid",
  oneTime: true,
  description:
    "x402-doctor: grade any x402 402 response for CDP Bazaar v2 indexing compliance and return the exact corrected payload.",
  bazaarOutputSchema: {
    input: {
      type: "http",
      method: "GET",
    },
    output: {
      tool: TAP_SLUG,
      version: 1,
      score: 42,
      grade: "F",
      indexable: false,
      criticalCount: 3,
      summary: "This is x402 v1 — it will not index on the Bazaar. Apply the corrected payload, redeploy, then settle one payment.",
      corrected: { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453" }] },
    },
  },
};

export async function onRequestOptions() {
  return corsOptions("GET, POST, OPTIONS");
}

export async function onRequestGet(context) {
  return handle(context, parseGetInput(context.request));
}

export async function onRequestPost(context) {
  let input;
  try {
    input = await parsePostInput(context.request);
  } catch {
    return accessJson(
      { error: "invalid_json", note: "POST a JSON body: { url } or { body }." },
      400,
      { "Access-Control-Allow-Origin": "*" }
    );
  }
  return handle(context, input);
}

function parseGetInput(request) {
  const u = new URL(request.url);
  return { url: u.searchParams.get("url") || null, body: null };
}

async function parsePostInput(request) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const raw = (await request.text()).trim();
    if (!raw) return { url: null, body: null };
    return { url: null, body: JSON.parse(raw) };
  }
  const data = await request.json();
  if (typeof data?.body === "string") {
    return { url: data.url || null, body: JSON.parse(data.body) };
  }
  return { url: data?.url || null, body: data?.body ?? null };
}

function handle(context, input) {
  const payload = async () => runDiagnosis(input);
  return handlePaidFetch(context, PRODUCT, payload, async (token) => {
    const tab = await hasBarTabAccess(token, context.env);
    if (tab) return { ok: true, claims: tab };
    const toolClaims = await hasToolAccess(token, TOOL_SLUG, context.env);
    if (toolClaims) return { ok: true, claims: toolClaims };
    return consumeMicroAccess(token, TAP_SLUG, TOOL_SLUG, context.env);
  });
}

async function runDiagnosis(input) {
  if (!input.url && !input.body) {
    return {
      tool: TAP_SLUG,
      error: "no_input",
      note: "Provide a target to diagnose.",
      usage: {
        fetch_live: "GET /api/bar/x402/doctor?url=https://your-host/your/endpoint",
        paste_body: 'POST /api/bar/x402/doctor  { "body": { …your 402 json… } }',
      },
    };
  }

  if (input.url) {
    if (!isSafeUrl(input.url)) {
      return {
        tool: TAP_SLUG,
        error: "unsafe_url",
        note: "Target must be an absolute https URL on a public host.",
        provided: input.url,
      };
    }
    let res;
    try {
      res = await fetchWithTimeout(
        input.url,
        { method: "GET", headers: { Accept: "application/json" } },
        DEFAULT_FETCH_TIMEOUT_MS
      );
    } catch {
      return { tool: TAP_SLUG, error: "fetch_failed", note: "Could not reach the target URL.", provided: input.url };
    }
    const text = await res.text();
    let body402;
    try {
      body402 = JSON.parse(text);
    } catch {
      return {
        tool: TAP_SLUG,
        error: "target_not_json",
        note: "The target did not return a JSON body to diagnose. A compliant endpoint returns HTTP 402 with a JSON payment-required body.",
        fetched: { status: res.status, contentType: res.headers.get("content-type") },
        raw: text.slice(0, 500),
      };
    }
    const report = diagnose402(body402, { sourceUrl: input.url });
    report.fetched = {
      url: input.url,
      status: res.status,
      was_402: res.status === 402,
      contentType: res.headers.get("content-type"),
    };
    if (res.status !== 402) {
      report.checks.unshift({
        id: "http_402",
        label: "Endpoint returns HTTP 402 on bare request",
        severity: "critical",
        status: "fail",
        detail: `Target returned HTTP ${res.status}, not 402. The CDP crawler must receive 402 on an unauthenticated request, or it cannot index the service.`,
        fix: "Return status 402 with the payment-required JSON body before any session/auth gate.",
      });
      report.indexable = false;
      report.summary = "Endpoint does not return 402 on a bare request. " + report.summary;
    }
    return report;
  }

  return diagnose402(input.body, {});
}

function isSafeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (h === "[::1]" || h.startsWith("[fc") || h.startsWith("[fd") || h.startsWith("[fe80")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const p = h.split(".").map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return false;
    if (p[0] === 169 && p[1] === 254) return false;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
    if (p[0] === 192 && p[1] === 168) return false;
  }
  return true;
}
