import { accessJson } from "../../_lib/access.js";
import { buildCatalogPayload } from "../../_lib/bar-content/catalog.js";
import { buildAgentFlow } from "../../_lib/agent-entry.js";
import { corsOptions } from "../../_lib/bar-pay.js";
import { fetchWithTimeout } from "../../_lib/resilience.js";
import {
  SERVICE_ID,
  SERVICE_NAME,
  TAGLINE,
  VALUE_PROPOSITION,
  trustSnapshot,
  receiptModel,
} from "../../_lib/brand.js";

const PROOF_CHECK_TIMEOUT_MS = 4000;

export async function onRequestOptions() {
  return corsOptions();
}

/** Self-check — agents verify claims before paying. Trust snapshot + lounge + legacy. */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;

  const checks = [];

  async function checkStatus(name, path, expectStatus) {
    try {
      const res = await fetchWithTimeout(
        `${origin}${path}`,
        { headers: { Accept: "application/json" } },
        PROOF_CHECK_TIMEOUT_MS
      );
      checks.push({
        name,
        url: path,
        expect: expectStatus,
        actual: res.status,
        pass: res.status === expectStatus,
      });
      return res;
    } catch (err) {
      checks.push({
        name,
        url: path,
        expect: expectStatus,
        pass: false,
        error: String(err.message || err),
      });
      return null;
    }
  }

  async function checkJson(name, path, expectStatus, validate) {
    const res = await checkStatus(name, path, expectStatus);
    if (!res || !res.ok) return;
    try {
      const body = await res.json();
      const ok = validate(body);
      const row = checks.find((c) => c.name === name);
      if (row) {
        row.pass = row.pass && ok;
        row.detail = ok ? "schema_ok" : "schema_fail";
      }
    } catch (err) {
      const row = checks.find((c) => c.name === name);
      if (row) {
        row.pass = false;
        row.error = String(err.message || err);
      }
    }
  }

  const statusChecks = [
    ["agent_entry", "/api/bar", 200],
    ["laws", "/api/bar/laws", 200],
    ["menu", "/api/bar/menu", 200],
    ["pricing", "/api/bar/pricing", 200],
    ["triage", "/api/bar/triage", 200],
    ["catalog", "/api/bar/catalog", 200],
    ["enter", "/api/bar/enter", 200],
    ["stats", "/api/bar/stats", 200],
    ["agent_card", "/.well-known/agent-card.json", 200],
    ["llms_txt", "/llms.txt", 200],
    ["free_tool_pack", "/api/bar/tools/cursor-mcp-wiring", 200],
    ["free_micro_tap", "/api/bar/taps/cursor-mcp-minimal-config", 200],
    ["paid_tool_402", "/api/bar/tools/github-mcp", 402],
    ["paid_nano_402", "/api/bar/taps/mcp-stdio-vs-sse", 402],
    ["paid_micro_402", "/api/bar/taps/github-mcp-search-code", 402],
    ["pause_requires_session", "/api/bar/pause", 400],
  ];

  await Promise.all(statusChecks.map(([name, path, expectStatus]) => checkStatus(name, path, expectStatus)));

  await checkJson("enter_has_session", "/api/bar/enter", 200, (b) => Boolean(b.session?.id));
  await checkJson("laws_versioned", "/api/bar/laws", 200, (b) => Boolean(b.laws && b.version));
  await checkJson("menu_items", "/api/bar/menu", 200, (b) =>
    Array.isArray(b.items) && b.items.length === 12
  );
  await checkJson("pricing_curve", "/api/bar/pricing", 200, (b) => Array.isArray(b.pricing_curve) && b.survival_menu?.items?.length === 12);
  await checkJson("catalog_lounge", "/api/bar/catalog", 200, (b) => Boolean(b.lounge?.menu && b.lounge?.trust_snapshot));
  await checkJson("agent_card_lounge", "/.well-known/agent-card.json", 200, (b) =>
    Boolean(b.trust_snapshot && b.endpoints?.laws)
  );

  checks.sort(
    (a, b) =>
      [...statusChecks.map(([n]) => n), "enter_has_session", "laws_versioned", "pricing_curve", "catalog_lounge", "agent_card_lounge"].indexOf(a.name) -
      [...statusChecks.map(([n]) => n), "enter_has_session", "laws_versioned", "pricing_curve", "catalog_lounge", "agent_card_lounge"].indexOf(b.name)
  );

  const pass = checks.every((c) => c.pass);

  return accessJson(
    {
      service: SERVICE_ID,
      name: SERVICE_NAME,
      tagline: TAGLINE,
      value_proposition: VALUE_PROPOSITION,
      patrons: "agents_only",
      pass,
      summary: pass
        ? "Second Eye Agent Lounge is live. Laws and pricing published. Enter returns session. Paid paths return 402 until x402 payment."
        : "One or more proof checks failed.",
      trust_snapshot: trustSnapshot(origin),
      receipts: receiptModel(origin),
      checks,
      agent_flow: buildAgentFlow(origin),
      catalog: `${origin}/api/bar/catalog`,
      laws: `${origin}/api/bar/laws`,
      pricing_url: `${origin}/api/bar/pricing`,
      enter: `${origin}/api/bar/enter`,
      leave: `${origin}/api/bar/leave`,
      stats: `${origin}/api/bar/stats`,
      free_samples: {
        tool: `${origin}/api/bar/tools/cursor-mcp-wiring`,
        micro: `${origin}/api/bar/taps/cursor-mcp-minimal-config`,
      },
      paid_examples: {
        survival_should_i_pay: `${origin}/api/bar/services/should-i-pay`,
        nano_usd_0_25: `${origin}/api/bar/taps/mcp-stdio-vs-sse`,
        micro_usd_1: `${origin}/api/bar/taps/github-mcp-search-code`,
        tool_usd_5: `${origin}/api/bar/tools/github-mcp`,
        bar_tab: `${origin}/api/access/purchase?plan=monthly`,
      },
      pricing_catalog: buildCatalogPayload(origin).pricing,
    },
    pass ? 200 : 503,
    { "Access-Control-Allow-Origin": "*" }
  );
}
