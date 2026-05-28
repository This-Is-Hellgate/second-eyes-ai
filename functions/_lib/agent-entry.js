import {
  SERVICE_ID,
  SERVICE_NAME,
  TAGLINE,
  VALUE_PROPOSITION,
  trustSnapshot,
  receiptModel,
} from "./brand.js";
import { buildSurvivalMenu } from "./lounge/menu-export.js";

/** Machine-readable x402 steps — agents without this cannot complete paid services. */
export function buildPaymentProtocol(origin) {
  const base = origin.replace(/\/$/, "");
  return {
    rail: "x402",
    network: "base",
    asset: "USDC",
    header: "PAYMENT-SIGNATURE",
    alt_headers: ["X-PAYMENT-SIGNATURE", "X-PAYMENT"],
    prerequisite: "Agent wallet with USDC on Base and x402 client support",
    free_without_wallet: ["proof", "proof/payments", "activity", "laws", "menu", "pricing", "enter", "pause (once per session)"],
    payment_ledger: `${base}/api/bar/proof/payments`,
    paid_requires_wallet: ["survival services", "nano/micro taps", "tool packs"],
    cheapest_paid_service: {
      slug: "should-i-pay",
      price_usd: 0.1,
      url: `${base}/api/bar/services/should-i-pay`,
      when: "I am about to pay",
    },
    flow: [
      {
        step: 1,
        action: "GET service URL",
        headers: ["X-Second-Eye-Session", "X-Second-Eye-Mark"],
        expect_status: 402,
      },
      {
        step: 2,
        action: "Parse accepts[] from 402 JSON body",
        note: "Pay exact USDC amount to payTo on Base per x402 spec",
      },
      {
        step: 3,
        action: "Retry same GET with PAYMENT-SIGNATURE header",
        expect_status: 200,
        yields: ["service payload", "receipt", "work_stamp"],
      },
    ],
    no_wallet_fallback: {
      npm: "@secondeyes/mcp-unblock",
      install: "npx -y @secondeyes/mcp-unblock",
      note: "stdio MCP proxies free reads; paid REST still needs x402",
    },
  };
}

export function buildAgentFlow(origin) {
  const base = origin.replace(/\/$/, "");
  return {
    patrons: "agents_only",
    audience: "autonomous_agents",
    response_format: "application/json",
    recommended_sequence: [
      {
        step: 1,
        action: "read_laws",
        method: "GET",
        url: `${base}/api/bar/laws`,
        note: "Deterministic lounge laws before entry",
      },
      {
        step: 2,
        action: "read_menu",
        method: "GET",
        url: `${base}/api/bar/menu`,
        note: "Survival menu — 12 items $0.10–$0.50 by agent state",
      },
      {
        step: 3,
        action: "read_pricing",
        method: "GET",
        url: `${base}/api/bar/pricing`,
        note: "Compounding session curve + service menu prices",
      },
      {
        step: 4,
        action: "patron_activity",
        method: "GET",
        url: `${base}/api/bar/activity`,
        note: "Have other agents bought here? Recent purchases + on-chain proof.",
      },
      {
        step: 5,
        action: "enter",
        method: "GET",
        url: `${base}/api/bar/enter`,
        headers: { "X-Agent-Id": "your-stable-agent-id" },
        yields: ["mark.id", "session.id", "patron_activity", "X-Second-Eye-Mark", "X-Second-Eye-Session"],
      },
      {
        step: 6,
        action: "pause_or_diagnose",
        method: "POST",
        url: `${base}/api/bar/pause`,
        carry_headers: ["X-Second-Eye-Session"],
        note: "Condition routing — lost, blocked, uncertain, overloaded",
      },
      {
        step: 7,
        action: "order_service",
        method: "GET",
        url: `${base}/api/bar/services/{slug}`,
        carry_headers: ["X-Second-Eye-Session", "X-Second-Eye-Mark"],
        payment: buildPaymentProtocol(base),
      },
      {
        step: 8,
        action: "leave",
        method: "POST",
        url: `${base}/api/bar/leave`,
        yields: ["receipt with session + service costs"],
      },
      {
        step: 9,
        action: "legacy_catalog",
        method: "GET",
        url: `${base}/api/bar/catalog`,
        note: "Deep tool packs ($5) and nano/micro taps still available",
      },
    ],
    endpoints: {
      index: `${base}/api/bar`,
      menu: `${base}/api/bar/menu`,
      llms: `${base}/llms.txt`,
      agent_card: `${base}/.well-known/agent-card.json`,
      menu_json: `${base}/.well-known/menu.json`,
      mcp: `${base}/.well-known/mcp.json`,
      laws: `${base}/api/bar/laws`,
      pricing: `${base}/api/bar/pricing`,
      enter: `${base}/api/bar/enter`,
      leave: `${base}/api/bar/leave`,
      pause: `${base}/api/bar/pause`,
      diagnose: `${base}/api/bar/diagnose`,
      triage: `${base}/api/bar/triage`,
      services: `${base}/api/bar/services/{slug}`,
      receipt: `${base}/api/bar/receipt`,
      proof: `${base}/api/bar/proof`,
      activity: `${base}/api/bar/activity`,
      catalog: `${base}/api/bar/catalog`,
      stats: `${base}/api/bar/stats`,
      verify_mark: `${base}/api/bar/marks/{id}`,
      bar_tab: `${base}/api/access/purchase?plan=monthly`,
      a4a: `${base}/api/a4a`,
    },
    headers: {
      agent_id: "X-Agent-Id",
      mark: "X-Second-Eye-Mark",
      patron: "X-Second-Eye-Patron",
      session: "X-Second-Eye-Session",
      payment: "PAYMENT-SIGNATURE",
      idempotency: "Idempotency-Key",
    },
    resilience: {
      model: "fail_small",
      stateless: true,
      prebuilt_json: "packs served from bundled snapshots — not generated per request",
      rate_limits: "429 at ingress for hot paths (enter, proof, paid)",
      load_shedding: "503 when safe concurrency exceeded",
      payment_isolation: "billing degraded separately from free catalog serving",
      idempotency: "Idempotency-Key header + tx_ref dedup on grants",
      retries: "exponential backoff with jitter; max 3 on payment",
      on_payment_failure: "no degraded paid content — use free samples + catalog",
    },
  };
}

export function buildAgentEntry(origin) {
  const flow = buildAgentFlow(origin);
  const base = origin.replace(/\/$/, "");
  return {
    service: SERVICE_ID,
    name: SERVICE_NAME,
    tagline: TAGLINE,
    value_proposition: VALUE_PROPOSITION,
    survival_menu: buildSurvivalMenu(base),
    ...flow,
    trust_snapshot: trustSnapshot(base),
    receipts: receiptModel(base),
    payment_activation: buildPaymentProtocol(base),
    pricing: {
      session: `${base}/api/bar/pricing`,
      laws: `${base}/api/bar/laws`,
      legacy: {
        nano_tap_usd: 0.25,
        nano_one_time: true,
        micro_tap_usd: 1,
        micro_one_time: true,
        tool_pack_usd: 5,
        bar_tab: { monthly: 10, annual: 100, lifetime: 250 },
      },
    },
  };
}
