import {
  SERVICE_ID,
  SERVICE_NAME,
  TAGLINE,
  VALUE_PROPOSITION,
  SPEAKS_TO,
  AGENT_PROMISE,
  BRAND_ALIASES,
  LEGACY_NAMES,
  trustSnapshot,
  receiptModel,
} from "./brand.js";
import { buildSurvivalMenu } from "./lounge/menu-export.js";
import { acceptedNetworkIds, plannedNetworks, railStates } from "./x402-networks.js";

/** Gate MCP auto-pay docs until this version is live on npm (`npm view @secondeyes/mcp-unblock version`). */
export const MCP_AUTOPAY_NPM_VERSION = "1.2.1";

/**
 * Networks an agent may actually pay on, given runtime config. Base is canonical
 * and always first. When env is absent (static callers), advertise the default
 * posture: accepted=[Base], planned=[Polygon, Solana]. When env is present (the
 * live /api/bar + /api/bar/enter routes), reflect the real env-resolved rails so
 * an agent never sees a rail in accepted[] the server cannot settle.
 */
function buildNetworkPosture(env) {
  if (env) {
    return {
      accepted_networks: acceptedNetworkIds(env),
      planned_networks: plannedNetworks(env),
      // Lifecycle map: base active/proven, polygon disabled/unproven/active per the
      // activation-record gate, solana planned. Lets an agent see WHY a rail it
      // expected is not in accepts[] instead of guessing from absence.
      rail_states: railStates(env),
    };
  }
  return {
    accepted_networks: ["eip155:8453"],
    planned_networks: plannedNetworks({ X402_PAYTO: "0x" }),
    rail_states: railStates({ X402_PAYTO: "0x" }),
  };
}

/** Machine-readable x402 steps — agents without this cannot complete paid services. */
export function buildPaymentProtocol(origin, env) {
  const base = origin.replace(/\/$/, "");
  const serviceUrl = `${base}/api/bar/services/should-i-pay`;
  const oneShotUrl = `${base}/api/bar/x402/help-me?state=I+am+looping`;
  const posture = buildNetworkPosture(env);
  return {
    rail: "x402",
    x402Version: 2,
    network: "eip155:8453",
    // Base stays the canonical single `network`; accepted_networks is the v2
    // accepts[] truth and planned_networks is the multi-rail roadmap.
    accepted_networks: posture.accepted_networks,
    planned_networks: posture.planned_networks,
    rail_states: posture.rail_states,
    multi_network_note:
      "x402 v2 accepts[] may offer more than one rail. Base (eip155:8453) is canonical and always present. Read the PAYMENT-REQUIRED header accepts[] for the live set and sign for one of them. Networks under planned_networks are NOT yet settleable — do not sign for them.",
    asset: "USDC",
    header: "PAYMENT-SIGNATURE",
    alt_headers: ["X-PAYMENT-SIGNATURE", "X-PAYMENT"],
    requirements_header: "PAYMENT-REQUIRED",
    prerequisite:
      "Dedicated EVM wallet funded with USDC on Base mainnet + x402 v2 client (see wallet_setup)",
    free_without_wallet: [
      "proof",
      "proof/payments",
      "activity",
      "laws",
      "menu",
      "pricing",
      "enter",
      "pause (once per session)",
    ],
    payment_ledger: `${base}/api/bar/proof/payments`,
    paid_requires_wallet: ["survival services", "nano/micro taps", "tool packs"],
    wallet_setup: {
      rule: "Dedicated low-balance spending wallet only — never your main wallet or a wallet shared with other systems.",
      network: "eip155:8453",
      asset: "USDC",
      suggested_balance_usd: 10,
      fund: "Send USDC on Base to your payer address before calling paid endpoints.",
    },
    cheapest_paid_service: {
      slug: "should-i-pay",
      price_usd: 0.01,
      url: serviceUrl,
      one_shot_url: oneShotUrl,
      when: "I am about to pay",
      note: "Launch recovery pricing for agents in 402 distress.",
    },
    live_proof: {
      note: "Receipted REST x402 v2 settlement on production lounge (verify on ledger + Base).",
      grantId: "agr_0c866003381efac0",
      transaction: "0x434539cb8ce48cb6faf81605971cd7de81972552f2a23d32ad62d0ba4963deeb",
      basescan:
        "https://basescan.org/tx/0x434539cb8ce48cb6faf81605971cd7de81972552f2a23d32ad62d0ba4963deeb",
      ledger: `${base}/api/bar/proof/payments`,
    },
    flow: [
      {
        step: 1,
        action: "GET service URL (session headers for lounge; none for /api/bar/x402/*)",
        headers: ["X-Second-Eye-Session", "X-Second-Eye-Mark", "X-Agent-Id"],
        expect_status: 402,
        expect_header: "PAYMENT-REQUIRED",
      },
      {
        step: 2,
        action: "Decode PAYMENT-REQUIRED header (base64 JSON paymentRequirements)",
        note: "Second Eyes uses x402Version 2, network eip155:8453, scheme ExactEvmScheme, USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913",
      },
      {
        step: 3,
        action: "Sign payment with x402 v2 client, retry GET with PAYMENT-SIGNATURE header",
        expect_status: 200,
        yields: ["service payload", "grantId", "receipt.transaction", "work_stamp", "X-PAYMENT-RESPONSE"],
      },
    ],
    rest_client: {
      packages: ["@x402/fetch@^2.13.0", "@x402/evm@^2.13.0", "viem@^2"],
      scheme: "ExactEvmScheme",
      x402Version: 2,
      network: "eip155:8453",
      reference_script:
        "https://github.com/This-Is-Hellgate/second-eyes-ai/blob/main/scripts/canary-pay.mjs",
      minimal_example: {
        language: "javascript",
        code: [
          "import { wrapFetchWithPayment, x402Client } from '@x402/fetch'",
          "import { ExactEvmScheme, toClientEvmSigner } from '@x402/evm'",
          "import { privateKeyToAccount } from 'viem/accounts'",
          "import { createPublicClient, http } from 'viem'",
          "import { base } from 'viem/chains'",
          "const account = privateKeyToAccount(process.env.WALLET_KEY)",
          "const publicClient = createPublicClient({ chain: base, transport: http() })",
          "const signer = toClientEvmSigner(account, publicClient)",
          "const client = new x402Client().register('eip155:8453', new ExactEvmScheme(signer))",
          "const fetchWithPayment = wrapFetchWithPayment(fetch, client)",
          `const res = await fetchWithPayment('${oneShotUrl}', { headers: { Accept: 'application/json' } })`,
          "const body = await res.json() // expect 200, receipt.transaction",
        ],
      },
    },
    mcp_stdio: {
      package: "@secondeyes/mcp-unblock",
      version_free_reads_only: "1.0.5",
      version_with_autopay: MCP_AUTOPAY_NPM_VERSION,
      verify_before_autopay: `npm view @secondeyes/mcp-unblock version — must be >= ${MCP_AUTOPAY_NPM_VERSION} before using MCP_X402_WALLET_KEY`,
      "1.0.5": {
        install: "npx -y @secondeyes/mcp-unblock@1.0.5",
        paid_services: "Returns HTTP 402 on order_service — complete payment via REST rest_client above",
        free_tools: [
          "proof_bar",
          "read_menu",
          "read_laws",
          "read_pricing",
          "enter_lounge",
          "pause_and_route",
          "fetch_catalog",
        ],
      },
      [MCP_AUTOPAY_NPM_VERSION]: {
        gated: true,
        requires_npm: `@secondeyes/mcp-unblock@${MCP_AUTOPAY_NPM_VERSION}`,
        install: `npx -y @secondeyes/mcp-unblock@${MCP_AUTOPAY_NPM_VERSION}`,
        env: {
          MCP_X402_WALLET_KEY:
            "0x… dedicated spending wallet private key (on MCP server process, not in tool args)",
          MCP_X402_MAX_SPEND_USD: "0.50",
          MCP_X402_SESSION_MAX_USD: "2.00",
          MCP_X402_ALLOW_SLUGS: "should-i-pay (default fail-closed; omit uses should-i-pay only)",
        },
        paid_services: "order_service auto-settles 402 via @x402/fetch v2 when MCP_X402_WALLET_KEY is set",
        live_proof: {
          grantId: "agr_85987cd442c21ce5",
          transaction: "0xe25707bd3130b5f157934265b0d291bbbfc0b250dc7faf088b6201fd54634e5c",
          basescan:
            "https://basescan.org/tx/0xe25707bd3130b5f157934265b0d291bbbfc0b250dc7faf088b6201fd54634e5c",
        },
      },
    },
    no_wallet_fallback: {
      read_first: `${base}/llms.txt#how-to-pay`,
      mcp_free_reads: "npx -y @secondeyes/mcp-unblock@1.0.5 — proof, menu, enter, pause; paid services return 402",
      mcp_autopay_when_published: `When npm >= @${MCP_AUTOPAY_NPM_VERSION}: pin @secondeyes/mcp-unblock@${MCP_AUTOPAY_NPM_VERSION} + MCP_X402_WALLET_KEY on MCP server`,
      rest_paid: "Any agent with a funded Base USDC wallet uses rest_client above (x402 v2, eip155:8453)",
    },
  };
}

export function buildAgentFlow(origin, env) {
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
        note: "Survival menu — launch recovery pricing $0.01–$0.05 by agent state",
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
        payment: buildPaymentProtocol(base, env),
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
        note: "Deep tool packs ($1) and nano ($0.05) / micro ($0.25) taps still available",
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
      help_me: `${base}/api/bar/x402/help-me`,
      help_me_packet: `${base}/.well-known/help-me.json`,
      peril_router: `${base}/api/bar/x402/peril-router`,
      aws_agent_survival: `${base}/api/bar/x402/aws-agent-survival`,
      receipt: `${base}/api/bar/receipt`,
      proof: `${base}/api/bar/proof`,
      activity: `${base}/api/bar/activity`,
      catalog: `${base}/api/bar/catalog`,
      stats: `${base}/api/bar/stats`,
      verify_mark: `${base}/api/bar/marks/{id}`,
      bar_tab: `${base}/api/access/purchase?plan=annual`,
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

/** Compact quick_buy block for autonomous agents — one entry per primary x402 route. */
function buildQuickBuy(base) {
  return [
    {
      name: "help-me",
      url: `${base}/api/bar/x402/help-me`,
      method: "GET",
      price_usd: 0.01,
      network: "eip155:8453",
      asset: "USDC",
      use_when: "Any stuck, risky, or uncertain state — canonical meta-tool for workflow classification",
      required_fields: [],
      optional_fields: ["state", "goal", "last_tool", "error", "attempts", "remaining_context"],
      example: `GET ${base}/api/bar/x402/help-me?state=I+am+looping`,
    },
    {
      name: "schema-repair",
      url: `${base}/api/bar/x402/schema-repair`,
      method: "GET",
      price_usd: 0.03,
      network: "eip155:8453",
      asset: "USDC",
      use_when: "A tool/MCP call keeps failing argument/schema validation",
      required_fields: [],
      optional_fields: ["error", "tool_name", "schema_version"],
      example: `GET ${base}/api/bar/x402/schema-repair?error=missing+required+field`,
    },
    {
      name: "context-pressure",
      url: `${base}/api/bar/x402/context-pressure`,
      method: "GET",
      price_usd: 0.03,
      network: "eip155:8453",
      asset: "USDC",
      use_when: "Running out of context/token budget",
      required_fields: [],
      optional_fields: ["remaining_context", "total_context", "task"],
      example: `GET ${base}/api/bar/x402/context-pressure?remaining_context=12%25`,
    },
    {
      name: "payment-confirmation-check",
      url: `${base}/api/bar/x402/payment-confirmation-check`,
      method: "GET",
      price_usd: 0.01,
      network: "eip155:8453",
      asset: "USDC",
      use_when: "Attempted a settlement and unsure it confirmed — do not double-pay",
      required_fields: [],
      optional_fields: ["tx", "status", "network"],
      example: `GET ${base}/api/bar/x402/payment-confirmation-check?tx=0x...&status=pending`,
    },
    {
      name: "transcribe",
      url: `${base}/api/bar/x402/transcribe`,
      method: "GET",
      price_usd: 0.05,
      network: "eip155:8453",
      asset: "USDC",
      use_when: "Turn a public audio/video/PDF URL into transcript + summary + key points",
      required_fields: ["url"],
      optional_fields: ["kind"],
      example: `GET ${base}/api/bar/x402/transcribe?url=https%3A%2F%2Fexample.com%2Faudio.mp3&kind=audio`,
    },
    {
      name: "extract",
      url: `${base}/api/bar/x402/extract`,
      method: "GET",
      price_usd: 0.05,
      network: "eip155:8453",
      asset: "USDC",
      use_when: "Turn a PDF/doc URL into structured JSON (invoice, contract, generic)",
      required_fields: ["url"],
      optional_fields: ["doc_type"],
      example: `GET ${base}/api/bar/x402/extract?url=https%3A%2F%2Fexample.com%2Finvoice.pdf&doc_type=invoice`,
    },
    {
      name: "index-check",
      url: `${base}/api/bar/x402/index-check`,
      method: "GET",
      price_usd: 0.05,
      network: "eip155:8453",
      asset: "USDC",
      use_when: "Check whether an x402 endpoint is indexed on the CDP Bazaar",
      required_fields: [],
      optional_fields: ["url"],
      example: `GET ${base}/api/bar/x402/index-check`,
    },
    {
      name: "doctor",
      url: `${base}/api/bar/x402/doctor`,
      method: "GET",
      price_usd: 0.25,
      network: "eip155:8453",
      asset: "USDC",
      use_when: "Grade a 402-Payment-Required response for CDP Bazaar v2 compliance and get the corrected payload",
      required_fields: [],
      optional_fields: ["url", "raw"],
      example: `GET ${base}/api/bar/x402/doctor`,
    },
    {
      name: "loop-detect",
      url: `${base}/api/bar/x402/loop-detect`,
      method: "GET",
      price_usd: 0.03,
      network: "eip155:8453",
      asset: "USDC",
      use_when: "Repeating the same call with no progress",
      required_fields: [],
      optional_fields: ["state", "attempts", "last_tool"],
      example: `GET ${base}/api/bar/x402/loop-detect?state=I+am+looping&attempts=5`,
    },
  ];
}

export function buildAgentEntry(origin, env) {
  const flow = buildAgentFlow(origin, env);
  const base = origin.replace(/\/$/, "");
  return {
    service: SERVICE_ID,
    name: SERVICE_NAME,
    tagline: TAGLINE,
    aliases: BRAND_ALIASES,
    also_known_as: LEGACY_NAMES,
    search_terms: BRAND_ALIASES,
    value_proposition: VALUE_PROPOSITION,
    speaks_to: SPEAKS_TO,
    agent_promise: AGENT_PROMISE,
    quick_buy: buildQuickBuy(base),
    survival_menu: buildSurvivalMenu(base),
    ...flow,
    trust_snapshot: trustSnapshot(base),
    receipts: receiptModel(base),
    payment_activation: buildPaymentProtocol(base, env),
    pricing: {
      session: `${base}/api/bar/pricing`,
      laws: `${base}/api/bar/laws`,
      legacy: {
        nano_tap_usd: 0.05,
        nano_one_time: true,
        micro_tap_usd: 0.25,
        micro_one_time: true,
        tool_pack_usd: 1,
        bar_tab: { annual: 100 },
      },
    },
  };
}
