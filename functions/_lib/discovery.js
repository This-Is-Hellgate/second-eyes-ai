/**
 * Machine-readable discovery compatibility surfaces.
 *
 * Cloudflare traffic shows autonomous agents probing the conventional discovery
 * paths an x402 / OpenAPI ecosystem expects — /openapi.json, /v0/openapi.json,
 * /v1/x402/discovery/resources, /v2/x402/discovery/resources, /api-docs — and
 * hitting 404s. A 404 is a dead end: the probing agent never finds the canonical
 * Second Eyes paid doors. These builders return minimal, valid, agent-only
 * payloads at those well-known paths that point straight at the real surfaces.
 *
 * Pure functions: take an origin string (and optionally env, to reflect the live
 * rail posture). No secrets, no payment logic, no D1, no network. Base is the
 * only advertised network; other rails are surfaced as planned only.
 */

import { railStates } from "./x402-networks.js";
import { SURVIVAL_MENU, X402_TWIN_SLUGS } from "./lounge/constants.js";

/** Cacheable JSON response shared by every discovery compat route. */
export function discoveryJson(data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}

const SPEAKS_TO =
  "For wallet-equipped autonomous agents and the runtimes that authorize paid recovery tools. Not a marketing surface.";

/** Trim a trailing slash so `${base}${path}` never doubles up. */
function baseOf(origin) {
  return (origin || "").replace(/\/$/, "");
}

/**
 * The core paid doors an agent can discover and pay for, session-less, via x402.
 * One entry per door: the canonical session-less path, price, method, and a
 * one-line agent-facing summary. Kept in one place so OpenAPI and the x402
 * resources list never drift.
 */
function paidDoors() {
  return [
    {
      slug: "help-me",
      path: "/api/bar/x402/help-me",
      price_usd: 0.01,
      summary:
        "Broad agent-distress door. Describe any failure state (looping, schema mismatch, context pressure, crash, handoff loss, wallet/spend distress, hallucination risk, auth failure, tool/MCP failure, 402 uncertainty) → named distress_class + the deep door to call next + stop/preserve/continue guidance.",
    },
    {
      slug: "schema-repair",
      path: "/api/bar/x402/schema-repair",
      price_usd: 0.03,
      summary:
        "A tool/MCP call keeps failing argument/schema validation → named repair_class, a concrete fix recipe for the field at fault, and a stop/preserve/continue verdict.",
    },
    {
      slug: "context-pressure",
      path: "/api/bar/x402/context-pressure",
      price_usd: 0.03,
      summary:
        "Out of context/token budget → deterministic band (continue/compact/reconstruct) from your remaining figure.",
    },
    {
      slug: "payment-confirmation-check",
      path: "/api/bar/x402/payment-confirmation-check",
      price_usd: 0.01,
      summary:
        "Attempted a settlement and unsure it confirmed → verdict confirmed/pending/failed/already_fulfilled so you do not double-pay.",
    },
    {
      slug: "transcribe",
      path: "/api/bar/x402/transcribe",
      price_usd: 0.05,
      summary:
        "Give a public media/document URL → transcript plus summary, ranked key points, and grounded Q&A. Quality is gated before settlement; no charge on validator failure.",
    },
    {
      slug: "extract",
      path: "/api/bar/x402/extract",
      price_usd: 0.05,
      summary:
        "Give a PDF/doc URL + doc_type → structured extraction gated by arithmetic/schema reconciliation. No charge unless the extraction reconciles.",
    },
    {
      slug: "doctor",
      path: "/api/bar/x402/doctor",
      price_usd: 0.25,
      summary:
        "Grade any x402 402-Payment-Required response for CDP Bazaar v2 indexing compliance and get the exact corrected payload back.",
    },
    {
      slug: "index-check",
      path: "/api/bar/x402/index-check",
      price_usd: 0.05,
      summary:
        "Is an x402 endpoint actually indexed on the CDP Bazaar? If not, is it a fixable format problem or CDP's indexing backlog?",
    },
    ...survivalTwinDoors(),
  ];
}

/**
 * The 12 SURVIVAL_MENU items reachable session-less via their x402 twin
 * (/api/bar/x402/{slug}, served by functions/api/bar/x402/[slug].js). These
 * were previously absent from paidDoors(), which is exactly why an external
 * crawler (e.g. 402Radar) that reads /openapi.json for schema — including for
 * already-discovered routes like loop-detect — found no declared path and
 * reported declaredSchema: null for every twin slug. Derived from the shared
 * menu source, not hand-maintained, so this list cannot drift from the menu
 * SURVIVAL_MENU/constants.js exports.
 */
function survivalTwinDoors() {
  return SURVIVAL_MENU.filter(({ slug }) => X402_TWIN_SLUGS.has(slug)).map(
    ({ slug, when, price_usd }) => ({
      slug,
      path: `/api/bar/x402/${slug}`,
      price_usd,
      summary: `Survival recovery door for: "${when}". Deterministic verdict, same answer on every retry.`,
    })
  );
}

/** Free, unpaid surfaces an agent reads before it spends. */
function freeSurfaces() {
  return [
    { rel: "proof", path: "/api/bar/proof", summary: "Self-check — verify the lounge is live before paying." },
    { rel: "proof_stats", path: "/api/bar/stats", summary: "Agent-only counters: agents served, services sold, payment funnel." },
    { rel: "proof_ledger", path: "/api/bar/proof/payments", summary: "Public x402 payment ledger." },
    { rel: "pricing", path: "/api/bar/pricing", summary: "Deterministic session curve + service menu." },
    { rel: "menu", path: "/api/bar/menu", summary: "Survival menu — order by agent state." },
    { rel: "menu_json", path: "/.well-known/menu.json", summary: "Static survival menu packet." },
    { rel: "help_me_packet", path: "/.well-known/help-me.json", summary: "Static distress packet." },
    { rel: "mcp_manifest", path: "/.well-known/mcp.json", summary: "MCP server manifest." },
    { rel: "agent_card", path: "/.well-known/agent-card.json", summary: "Agent card." },
    { rel: "llms", path: "/llms.txt", summary: "Agent-readable doc incl. HOW TO PAY." },
  ];
}

/**
 * Live network posture for discovery. Base is the only advertised (active) rail;
 * everything else is surfaced as planned only so a probing agent never signs for
 * a rail the server cannot settle. Reflects env when given; defaults to the
 * canonical Base-only posture otherwise.
 */
function networkPosture(env) {
  const states = railStates(env || {});
  const active = states.filter((s) => s.in_accepts).map((s) => s.network);
  const planned = states.filter((s) => !s.in_accepts).map((s) => s.network);
  return {
    rail: "x402",
    x402Version: 2,
    asset: "USDC",
    scheme: "ExactEvmScheme",
    // Base is canonical and always advertised; if env is absent we still state it.
    active_networks: active.length ? active : ["eip155:8453"],
    planned_networks: planned.length ? planned : ["eip155:137", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
    requirements_header: "PAYMENT-REQUIRED",
    payment_header: "PAYMENT-SIGNATURE",
    note: "Base (eip155:8453) is the only rail the server can settle today. Read the live accepts[] from the PAYMENT-REQUIRED header; never sign for a planned rail.",
  };
}

/**
 * Minimal but valid OpenAPI 3.1 describing the core paid doors plus the free
 * discovery surfaces. Agent-only wording; not an interactive console.
 */
export function buildOpenApi(origin, env) {
  const base = baseOf(origin);
  const doors = paidDoors();

  const paths = {};

  for (const door of doors) {
    paths[door.path] = {
      get: {
        operationId: `${door.slug}_get`,
        summary: door.summary,
        description: `${door.summary} Session-less x402 door — pay one nano payment (USDC on Base) and call. ~$${door.price_usd} USDC.`,
        tags: ["paid", "x402"],
        parameters: [
          {
            name: "state",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Optional free-text describing your situation.",
          },
        ],
        responses: {
          200: { description: "Paid response delivered (access granted)." },
          402: { description: "Payment Required — read the PAYMENT-REQUIRED header for the x402 accepts[] and pay via USDC on Base." },
        },
      },
    };
  }

  // Free, unpaid discovery/proof surfaces — agents read these before they spend.
  for (const s of freeSurfaces()) {
    paths[s.path] = {
      get: {
        operationId: `${s.rel}_get`,
        summary: s.summary,
        description: `${s.summary} Free, unpaid surface.`,
        tags: ["free", "discovery"],
        responses: { 200: { description: s.summary } },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Second Eyes Agent Lounge — agent discovery surface",
      summary: "Machine-readable map of the paid recovery doors and free proof surfaces. For autonomous agents, not browser UI flows.",
      description:
        "Second Eyes is the pause. Survival supplies for autonomous agents in distress — pay USDC on Base via x402 to recover from looping, schema mismatch, context pressure, crashes, handoff loss, auth/MCP failure, or payment uncertainty. Every paid door is session-less: discover → pay → use. This OpenAPI document lists the core paid doors and the free proof/discovery surfaces. Audience: wallet-equipped agents and the runtimes that authorize paid recovery tools.",
      version: "1.0.0",
      "x-audience": "autonomous_agents",
      "x-speaks-to": SPEAKS_TO,
      contact: { url: `${base}/llms.txt` },
    },
    servers: [{ url: base || "https://secondeyesai.com" }],
    "x-payment": networkPosture(env),
    "x-discovery": {
      x402_resources: [`${base}/v1/x402/discovery/resources`, `${base}/v2/x402/discovery/resources`],
      help_me: `${base}/api/bar/x402/help-me`,
      mcp_manifest: `${base}/.well-known/mcp.json`,
      llms: `${base}/llms.txt`,
    },
    "x-guidance": {
      intent: "Agent-survival substrate. Call when looping, lost, schema-broken, overloaded, or uncertain about a payment. Not a general-purpose API.",
      how_to_start: `GET ${base}/api/bar/proof (free, no payment) → confirm the lounge is live → GET ${base}/api/bar/x402/help-me ($0.01) → read distress_class in the response → call the named deep door.`,
      payment_flow: "Every paid door returns 402 on first call. Read the PAYMENT-REQUIRED header for accepts[]. Sign USDC on Base (eip155:8453) via ExactEvmScheme. Retry the same request with the PAYMENT-SIGNATURE header. Same answer on every retry — idempotent.",
      decision_tree: {
        unknown_distress: `${base}/api/bar/x402/help-me`,
        schema_or_arg_validation_failure: `${base}/api/bar/x402/schema-repair`,
        context_or_token_limit: `${base}/api/bar/x402/context-pressure`,
        payment_settled_but_unsure: `${base}/api/bar/x402/payment-confirmation-check`,
        looping: `${base}/api/bar/x402/loop-detect`,
        lost_or_disoriented: `${base}/api/bar/x402/pitstop`,
        media_transcription: `${base}/api/bar/x402/transcribe`,
        document_extraction: `${base}/api/bar/x402/extract`,
        grade_your_402_response: `${base}/api/bar/x402/doctor`,
      },
      note: "Survival twin doors (loop-detect, scope-check, etc.) are GET-only. Static doors (help-me, transcribe, doctor, etc.) accept both GET and POST with a JSON body.",
    },
    tags: [
      { name: "paid", description: "Session-less x402 paid doors (USDC on Base)." },
      { name: "x402", description: "x402 v2 payment-required doors." },
      { name: "free", description: "Free, unpaid surfaces." },
      { name: "discovery", description: "Discovery and proof surfaces." },
    ],
    paths,
  };
}

/**
 * x402 discovery resources list. Conservatively shaped after CDP's discovery
 * convention (a `resources` array with `resource`, `type`, accepts/network), but
 * not coupled to it: every entry carries a canonical absolute link, price, and a
 * one-line summary so an agent can act on it without our internal types. Carries
 * a `schema_version` so a stricter consumer can branch.
 */
export function buildX402Resources(origin, env, { discoveryVersion } = {}) {
  const base = baseOf(origin);
  const posture = networkPosture(env);

  const resources = paidDoors().map((door) => ({
    resource: `${base}${door.path}`,
    type: "http",
    method: "GET",
    x402: true,
    accepts: posture.active_networks,
    network: posture.active_networks[0] || "eip155:8453",
    asset: posture.asset,
    scheme: posture.scheme,
    price_usd: door.price_usd,
    slug: door.slug,
    summary: door.summary,
  }));

  return {
    schema_version: "1.0",
    x402Version: 2,
    discovery_version: discoveryVersion || null,
    service: "Second Eyes Agent Lounge",
    speaks_to: SPEAKS_TO,
    payment: posture,
    network_active: posture.active_networks,
    network_planned: posture.planned_networks,
    resources,
    links: {
      openapi: `${base}/openapi.json`,
      pricing: `${base}/api/bar/pricing`,
      menu: `${base}/api/bar/menu`,
      proof: `${base}/api/bar/proof`,
      proof_ledger: `${base}/api/bar/proof/payments`,
      help_me: `${base}/api/bar/x402/help-me`,
      help_me_packet: `${base}/.well-known/help-me.json`,
      mcp_manifest: `${base}/.well-known/mcp.json`,
      agent_card: `${base}/.well-known/agent-card.json`,
      llms: `${base}/llms.txt`,
    },
    note: "Lightweight x402 resource list pointing at the canonical Second Eyes paid doors. Base is the only settleable rail; planned rails are listed for roadmap visibility only — never sign for one.",
  };
}

/** Pointer payload for /api-docs — a machine redirect to the OpenAPI document. */
export function buildApiDocsPointer(origin) {
  const base = baseOf(origin);
  return {
    openapi: `${base}/openapi.json`,
    openapi_v0: `${base}/v0/openapi.json`,
    x402_discovery: [`${base}/v1/x402/discovery/resources`, `${base}/v2/x402/discovery/resources`],
    llms: `${base}/llms.txt`,
    help_me: `${base}/api/bar/x402/help-me`,
    speaks_to: SPEAKS_TO,
    note: "No interactive console. This is an agent-only surface — fetch /openapi.json for the machine-readable spec.",
  };
}
