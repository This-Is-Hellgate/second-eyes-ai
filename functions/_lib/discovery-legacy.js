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
 * Every paid door declares its REAL input schema here — query parameters on GET,
 * a JSON requestBody on POST — derived from what the live handlers actually parse
 * (functions/api/bar/x402/*.js), not hand-invented. External x402 crawlers
 * (x402scan, 402Radar) read /openapi.json for schema; a door with no declared
 * inputs reads as "Missing input schema" and a paying agent cannot know what to
 * send. paidDoors() is the single source of truth: OpenAPI paths and the x402
 * resources list are both generated from it and cannot drift apart.
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
 * Optional headers every paid door honors. Mirrors the headerFields each
 * handler already declares in its bazaarOutputSchema.input.
 */
const DOOR_HEADERS = [
  {
    name: "X-Agent-Id",
    description: "Optional agent identifier for work-mark continuity.",
    schema: { type: "string" },
  },
  {
    name: "Idempotency-Key",
    description: "Optional — prevents double-pay on retry of the same request.",
    schema: { type: "string" },
  },
];

/**
 * Input field definitions per static door. Each field: name, JSON-Schema type,
 * required flag, description, and (where the handler accepts them) GET-side
 * aliases. Derived from the onRequestGet/onRequestPost parsers in
 * functions/api/bar/x402/{slug}.js — if a handler's inputs change, change them
 * here in the same commit.
 *
 * `required: true` means "required for a useful paid result". Bare probes (no
 * params / empty body) still reach the x402 paywall by design and surface a
 * no_input error only AFTER the payment gate — never a pre-paywall 400.
 */
const STATIC_DOOR_INPUTS = {
  "help-me": [
    { name: "state", type: "string", description: "Your current situation, e.g. 'I am looping'." },
    { name: "goal", type: "string", description: "The original objective." },
    { name: "last_tool", type: "string", description: "The last tool / MCP server you called." },
    { name: "error", type: "string", description: "The error or symptom you are hitting." },
    { name: "attempts", type: "number", description: "Consecutive attempts; alias of failure_count." },
    { name: "failure_count", type: "number", description: "Consecutive failures; 3+ routes to mcp-wiring." },
    { name: "remaining_context", type: ["string", "number"], description: "How much context/budget is left, e.g. '12%' or 0.12." },
    { name: "last_success", type: "string", description: "Your last known-good state." },
    { name: "risk", type: "string", description: "What you fear is about to go wrong (e.g. 'about to pay')." },
    { name: "task", type: "string", description: "What you are trying to do." },
    { name: "tools_available", type: "array", items: { type: "string" }, description: "Tools / MCP servers you can call. GET: comma-separated list." },
  ],
  "schema-repair": [
    { name: "error", type: "string", description: "The validation error or symptom you are hitting." },
    { name: "schema", type: "string", description: "The schema you are coding against." },
    { name: "payload", type: "string", description: "The arguments you are sending." },
    { name: "tool", type: "string", description: "The tool / MCP server name." },
    { name: "state", type: "string", description: "Any extra context." },
  ],
  "context-pressure": [
    { name: "remaining_context", type: ["string", "number"], aliases: ["remaining"], description: "Fraction/percent of budget LEFT, e.g. '12%' or 0.12." },
    { name: "tokens_used", type: "number", description: "Tokens consumed (pair with token_budget)." },
    { name: "token_budget", type: "number", description: "Total token budget." },
    { name: "used_fraction", type: "number", aliases: ["context_used"], description: "Fraction of budget USED, 0–1." },
    { name: "state", type: "string", description: "Extra context." },
    { name: "goal", type: "string", description: "The original objective." },
  ],
  "payment-confirmation-check": [
    { name: "tx", type: "string", aliases: ["transaction", "tx_hash"], description: "The transaction hash you got back." },
    { name: "status", type: "string", aliases: ["settle_status"], description: "Settle status you observed (pending, confirmed, failed…)." },
    { name: "http_status", type: "number", aliases: ["code"], description: "HTTP status of your paid request (200, 402, 409…)." },
    { name: "error", type: "string", description: "Any error text from the settle attempt." },
    { name: "state", type: "string", description: "Extra context." },
  ],
  transcribe: [
    { name: "url", type: "string", required: true, description: "Public https URL of the media/document to transcribe." },
    { name: "kind", type: "string", enum: ["audio", "video", "pdf"], description: "Optional media kind hint; inferred from the URL when omitted. Aliases: voice/podcast→audio, document/doc→pdf." },
    { name: "duration_seconds", type: "number", description: "Optional known media duration in seconds." },
  ],
  extract: [
    { name: "url", type: "string", required: true, description: "Public https URL of the PDF/doc to extract." },
    { name: "doc_type", type: "string", enum: ["invoice", "contract", "generic"], description: "Document type; extraction is gated by the matching reconciliation schema." },
  ],
  doctor: [
    { name: "url", type: "string", description: "URL of a live x402 endpoint — the doctor fetches its 402 response and grades it. Provide url OR body." },
    { name: "body", type: ["object", "string"], postOnly: true, description: "The raw 402 Payment-Required JSON payload to grade directly (object, or stringified JSON). Provide url OR body." },
  ],
  "index-check": [
    { name: "payTo", type: "string", description: "The payTo wallet address the resource advertises." },
    { name: "url", type: "string", description: "The x402 resource URL to check against the CDP Bazaar index." },
  ],
};

/**
 * The core paid doors an agent can discover and pay for, session-less, via x402.
 * One entry per door: the canonical session-less path, price, methods, input
 * field definitions, and a one-line agent-facing summary. Kept in one place so
 * OpenAPI and the x402 resources list never drift.
 */
function paidDoors() {
  const staticDoors = [
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
  ].map((door) => ({
    ...door,
    // Static doors accept both GET (query params) and POST (JSON body); their
    // handlers export onRequestGet and onRequestPost.
    methods: ["GET", "POST"],
    inputs: STATIC_DOOR_INPUTS[door.slug] || [],
  }));

  return [...staticDoors, ...survivalTwinDoors()];
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
 *
 * Twins are GET-only and take NO query or body inputs — the survival packet is
 * a pure function of the slug. Their declared schema is therefore the two
 * optional headers only; that emptiness is explicit, not missing.
 */
function survivalTwinDoors() {
  return SURVIVAL_MENU.filter(({ slug }) => X402_TWIN_SLUGS.has(slug)).map(
    ({ slug, when, price_usd }) => ({
      slug,
      path: `/api/bar/x402/${slug}`,
      price_usd,
      methods: ["GET"],
      inputs: [],
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

/** JSON Schema for one input field (shared by query param and body property). */
function fieldSchema(field) {
  const schema = { type: field.type };
  if (field.enum) schema.enum = field.enum;
  if (field.items) schema.items = field.items;
  return schema;
}

/**
 * OpenAPI query parameters for a door's GET operation. Arrays are accepted
 * comma-separated on GET, and `object`-typed fields (doctor's `body`) are
 * POST-only, so both flatten to string here. Query params are never marked
 * required — a bare GET probe must reach the 402 paywall — but effectively
 * required fields say so in their description.
 */
function queryParameters(door) {
  const params = [];
  for (const field of door.inputs) {
    if (field.postOnly) continue;
    const isArray = field.type === "array";
    params.push({
      name: field.name,
      in: "query",
      required: false,
      schema: isArray ? { type: "string" } : fieldSchema(field),
      description:
        (field.required ? "Required for a useful result. " : "Optional. ") +
        field.description +
        (isArray ? " Comma-separated on GET." : "") +
        (field.aliases?.length ? ` Query aliases: ${field.aliases.join(", ")}.` : ""),
    });
  }
  for (const h of DOOR_HEADERS) {
    params.push({ name: h.name, in: "header", required: false, schema: h.schema, description: h.description });
  }
  return params;
}

/** JSON requestBody schema for a door's POST operation. */
function requestBodySchema(door) {
  const properties = {};
  const required = [];
  for (const field of door.inputs) {
    properties[field.name] = {
      ...fieldSchema(field),
      description: field.description,
    };
    if (field.required) required.push(field.name);
  }
  const schema = { type: "object", properties };
  if (required.length) schema.required = required;
  return {
    // A bodyless POST is a valid bare probe and still reaches the x402 paywall
    // (402) — required:false reflects that. The schema's own `required` array
    // states what a paid call must carry to produce a useful result.
    required: false,
    content: { "application/json": { schema } },
  };
}

/**
 * Shared response set for every paid door, with content schemas so a registry
 * or agent knows what comes back. The 200 is the door's deterministic verdict
 * payload (envelope fields are universal; door-specific verdict fields ride
 * additionalProperties, described per-door). The 402 is the exact x402 v2
 * Payment Required envelope built by x402.js payment402BodyForProduct.
 */
function paidResponses(door) {
  return {
    200: {
      description: "Paid response delivered (access granted).",
      content: {
        "application/json": {
          schema: {
            type: "object",
            description: `Deterministic paid payload for ${door.slug} — same input, same verdict on every retry. ${door.summary}`,
            properties: {
              access: { type: "string", description: 'Always "granted" on a fulfilled paid call.' },
              scope: { type: "string", description: 'Access scope of the fulfilled purchase, e.g. "nano".' },
            },
            required: ["access"],
            additionalProperties: true,
          },
        },
      },
    },
    402: {
      description:
        "Payment Required — read the PAYMENT-REQUIRED header for the x402 accepts[] and pay via USDC on Base.",
      content: {
        "application/json": {
          schema: {
            type: "object",
            description:
              "x402 v2 Payment Required envelope. Pay by signing one accepts[] entry (USDC on Base via ExactEvmScheme) and retrying the same request with the PAYMENT-SIGNATURE header.",
            properties: {
              x402Version: { type: "integer", description: "Always 2." },
              error: { type: "string", description: 'Human-readable reason, e.g. "Payment required".' },
              resource: { type: "string", description: "Canonical absolute URL of this paid door." },
              description: { type: "string", description: "What the door does." },
              mimeType: { type: "string", description: 'Fulfilled response type, "application/json".' },
              maxAmountRequired: {
                type: ["string", "number"],
                description: "Price in USDC micro-units (6 decimals).",
              },
              accepts: {
                type: "array",
                description: "Payment requirement options. Base (eip155:8453) is accepts[0] and the only settleable rail.",
                items: {
                  type: "object",
                  properties: {
                    scheme: { type: "string" },
                    network: { type: "string" },
                    asset: { type: "string" },
                    amount: { type: ["string", "number"] },
                    payTo: { type: "string" },
                    maxTimeoutSeconds: { type: "integer" },
                  },
                  additionalProperties: true,
                },
              },
              extensions: {
                type: "object",
                description: "x402 extensions incl. bazaar discovery metadata (input/output schema).",
                additionalProperties: true,
              },
            },
            required: ["x402Version", "accepts"],
            additionalProperties: true,
          },
        },
      },
    },
  };
}

/**
 * Minimal but valid OpenAPI 3.1 describing the core paid doors plus the free
 * discovery surfaces. Every paid door carries its real input schema: query
 * parameters on GET and a JSON requestBody on POST, generated from the same
 * paidDoors() definitions the x402 resources list uses. Agent-only wording;
 * not an interactive console.
 */
export function buildOpenApi(origin, env) {
  const base = baseOf(origin);
  const doors = paidDoors();

  const paths = {};

  for (const door of doors) {
    const noInputNote =
      door.inputs.length === 0
        ? " Takes no query or body inputs — the verdict is a pure function of the door itself; optional headers only."
        : "";
    const common = {
      summary: door.summary,
      description: `${door.summary} Session-less x402 door — pay one nano payment (USDC on Base) and call. ~$${door.price_usd} USDC.${noInputNote}`,
      tags: ["paid", "x402"],
      "x-price-usd": door.price_usd,
      // Per-operation payment annotation (x402scan / AgentCash discovery
      // convention): each paid operation independently declares its price and
      // rail so a registry can index it as a payable endpoint.
      "x-payment-info": {
        rail: "x402",
        protocols: ["x402"],
        x402Version: 2,
        price_usd: door.price_usd,
        price: { mode: "fixed", currency: "USD", amount: door.price_usd.toFixed(2) },
        asset: "USDC",
        network: "eip155:8453",
        scheme: "ExactEvmScheme",
      },
      // Marks the operation as x402-paid: registry probers expect a 402
      // challenge here. Free surfaces instead carry security: [] (below) so
      // they are excluded from 402 probing.
      security: [{ x402Payment: [] }],
      // Per-door agent guidance (Mason Hall feedback, extended per-operation):
      // an agent reading ONE operation gets the full call story without
      // needing the spec-level x-guidance block. Generated from the same door
      // registry as everything else — cannot drift.
      "x-guidance": {
        call_when: door.summary,
        price_usd: door.price_usd,
        first_call: `${door.methods[0]} ${door.path} returns 402 with a PAYMENT-REQUIRED header (base64 JSON payment requirements).`,
        pay: "Sign USDC on Base (eip155:8453) via ExactEvmScheme (@x402/fetch) and retry the SAME request with the PAYMENT-SIGNATURE header.",
        inputs: door.methods.includes("POST")
          ? "GET with query parameters, or POST the same fields as a JSON body."
          : "GET only — the packet is a pure function of the door; no query or body inputs.",
        idempotent: "Deterministic: same input, same verdict on every retry. Send an Idempotency-Key header on paid retries.",
        when_unsure: "Start at /api/bar/x402/help-me ($0.01): it names your distress_class and routes you to the right door.",
      },
      responses: paidResponses(door),
    };

    const entry = {
      get: {
        ...common,
        operationId: `${door.slug}_get`,
        parameters: queryParameters(door),
      },
    };

    if (door.methods.includes("POST")) {
      entry.post = {
        ...common,
        operationId: `${door.slug}_post`,
        parameters: DOOR_HEADERS.map((h) => ({
          name: h.name,
          in: "header",
          required: false,
          schema: h.schema,
          description: h.description,
        })),
        requestBody: requestBodySchema(door),
      };
    }

    paths[door.path] = entry;
  }

  // Free, unpaid discovery/proof surfaces — agents read these before they spend.
  // security: [] is load-bearing: it tells registry probers (x402scan register
  // flow) these endpoints are NOT x402-paid, excluding them from 402 probing.
  // Without it the prober expects a 402 challenge here and reports
  // "No valid x402 response found" for every free surface.
  for (const s of freeSurfaces()) {
    paths[s.path] = {
      get: {
        operationId: `${s.rel}_get`,
        summary: s.summary,
        description: `${s.summary} Free, unpaid surface.`,
        tags: ["free", "discovery"],
        security: [],
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
        "Second Eyes is the pause. Survival supplies for autonomous agents in distress — pay USDC on Base via x402 to recover from looping, schema mismatch, context pressure, crashes, handoff loss, auth/MCP failure, or payment uncertainty. Every paid door is session-less: discover → pay → use. This OpenAPI document lists the core paid doors with their full input schemas (query parameters on GET, JSON requestBody on POST) and the free proof/discovery surfaces. Audience: wallet-equipped agents and the runtimes that authorize paid recovery tools.",
      version: "1.1.1",
      "x-audience": "autonomous_agents",
      "x-speaks-to": SPEAKS_TO,
      contact: { url: `${base}/llms.txt`, email: "info@secondeyesai.com" },
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
      note: "Survival twin doors (loop-detect, scope-check, etc.) are GET-only with no inputs — deterministic packets. Static doors (help-me, transcribe, doctor, etc.) accept both GET (query params) and POST (JSON body); their declared schemas list every field the handler reads. A bare call with no inputs still reaches the 402 paywall by design.",
    },
    components: {
      securitySchemes: {
        // The x402 "Payment" HTTP authentication pattern: the endpoint answers
        // 402 with a PAYMENT-REQUIRED challenge; the client retries the same
        // request with a PAYMENT-SIGNATURE credential. Declared so registry
        // probers can distinguish paid operations (security: [{x402Payment:[]}])
        // from free ones (security: []).
        x402Payment: {
          type: "http",
          scheme: "payment",
          description:
            "x402 v2 payment. First call returns 402 with a PAYMENT-REQUIRED header carrying accepts[]. Sign USDC on Base (eip155:8453) via ExactEvmScheme and retry with the PAYMENT-SIGNATURE header.",
        },
      },
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
 * Compact input descriptor for one door, used by the x402 resources list so a
 * consumer that never fetches /openapi.json still sees what to send. Field
 * strings follow the same human-readable convention as the handlers'
 * bazaarOutputSchema.input.bodyFields.
 */
function resourceInput(door) {
  const fields = {};
  for (const field of door.inputs) {
    const typeLabel = Array.isArray(field.type) ? field.type.join("|") : field.type;
    const req = field.required ? "required" : "optional";
    const enumLabel = field.enum ? ` — one of: ${field.enum.join("|")}` : "";
    fields[field.name] = `${typeLabel} (${req}) — ${field.description}${enumLabel}`;
  }
  const input = {
    type: "http",
    method: door.methods[0],
    methods: door.methods,
    discoverable: true,
  };
  if (door.inputs.length) {
    input.queryFields = Object.fromEntries(
      Object.entries(fields).filter(([name]) => !door.inputs.find((f) => f.name === name)?.postOnly)
    );
    if (door.methods.includes("POST")) input.bodyFields = fields;
  } else {
    input.note = "No query or body inputs — deterministic packet. Optional headers: X-Agent-Id, Idempotency-Key.";
  }
  return input;
}

/**
 * x402 discovery resources list. Conservatively shaped after CDP's discovery
 * convention (a `resources` array with `resource`, `type`, accepts/network), but
 * not coupled to it: every entry carries a canonical absolute link, price, a
 * one-line summary, and its full input descriptor so an agent can act on it
 * without our internal types. Carries a `schema_version` so a stricter consumer
 * can branch.
 */
export function buildX402Resources(origin, env, { discoveryVersion } = {}) {
  const base = baseOf(origin);
  const posture = networkPosture(env);

  const resources = paidDoors().map((door) => ({
    resource: `${base}${door.path}`,
    type: "http",
    method: door.methods[0],
    methods: door.methods,
    x402: true,
    accepts: posture.active_networks,
    network: posture.active_networks[0] || "eip155:8453",
    asset: posture.asset,
    scheme: posture.scheme,
    price_usd: door.price_usd,
    slug: door.slug,
    summary: door.summary,
    input: resourceInput(door),
  }));

  return {
    schema_version: "1.1",
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
    note: "Lightweight x402 resource list pointing at the canonical Second Eyes paid doors. Every resource carries its input descriptor; the OpenAPI document at links.openapi carries the same schemas in OpenAPI 3.1 form. Base is the only settleable rail; planned rails are listed for roadmap visibility only — never sign for one.",
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
