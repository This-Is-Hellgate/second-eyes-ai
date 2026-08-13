/** Session-less x402 capability map for wallet-equipped agents. */
import {
  corsOptions,
  handlePaidFetch,
  hasBarTabAccess,
  hasToolAccess,
  consumeMicroAccess,
} from "../../../_lib/bar-pay.js";
import { SURVIVAL_MENU, X402_TWIN_SLUGS, SERVICE_PRICES } from "../../../_lib/lounge/constants.js";

const TOOL_SLUG = "lounge-survival";
const TAP_SLUG = "aws-agent-survival";
const PRICE_USD = 0.01;

const STANDALONE_DOORS = [
  { slug: "help-me", path: "/api/bar/x402/help-me", price_usd: 0.01, when: "I sense imminent failure and do not know which recovery capability I need", method: "GET|POST", canonical: true },
  { slug: "peril-router", path: "/api/bar/x402/peril-router", price_usd: 0.01, when: "Legacy alias of help-me", method: "GET|POST", legacy_alias_of: "help-me" },
  { slug: "schema-repair", path: "/api/bar/x402/schema-repair", price_usd: 0.03, when: "A tool call keeps failing schema validation", method: "GET|POST" },
  { slug: "context-pressure", path: "/api/bar/x402/context-pressure", price_usd: 0.03, when: "I am running out of context/token budget", method: "GET|POST" },
  { slug: "payment-confirmation-check", path: "/api/bar/x402/payment-confirmation-check", price_usd: 0.01, when: "I attempted a settlement and need to verify it before retrying", method: "GET|POST" },
  {
    slug: "analyze-video-audio-and-pdfs",
    path: "/api/bar/x402/analyze-video-audio-and-pdfs",
    price_usd: 0.05,
    when: "I am a text-only agent and need grounded understanding of a video, audio recording, or PDF without ingesting a verbatim transcript",
    media: true,
    refinery: true,
    method: "GET|POST",
  },
  {
    slug: "turn-paper-into-code",
    path: "/api/bar/x402/turn-paper-into-code",
    price_usd: 0.25,
    when: "I have a research paper and need an implementation-ready code repository with tests, assumptions, dependencies, and paper-grounding notes",
    media: true,
    refinery: true,
    method: "GET|POST",
  },
  { slug: "bazaar-index-check", path: "/api/bar/x402/index-check", price_usd: 0.05, when: "I need to inspect Bazaar discovery/index readiness", method: "GET|POST" },
  { slug: "x402-doctor", path: "/api/bar/x402/doctor", price_usd: 0.25, when: "My x402 endpoint has protocol or Bazaar production-readiness problems", method: "GET|POST" },
];

const DESCRIPTION =
  "Session-less x402 map for wallet-equipped agents. Includes compatibility recovery doors plus the confirmed Second Eyes Data Refinery products: analyze-video-audio-and-pdfs and turn-paper-into-code. Every entry gives the descriptive route, Base USDC price, and call condition.";

function buildSurvivalKit(origin) {
  const survival = SURVIVAL_MENU
    .filter((m) => X402_TWIN_SLUGS.has(m.slug))
    .map((m) => ({
      slug: m.slug,
      when: m.when,
      path: `${origin}/api/bar/x402/${m.slug}`,
      price_usd: SERVICE_PRICES[m.slug]?.price_usd ?? m.price_usd,
      method: "GET|POST",
      session_required: false,
    }));

  const standalone = STANDALONE_DOORS.map((d) => ({ ...d, path: `${origin}${d.path}`, session_required: false }));
  return {
    kit: "aws-agent-survival",
    audience: "autonomous one-shot wallet agents",
    session_required: false,
    payment: {
      rail: "x402",
      x402Version: 2,
      network: "eip155:8453",
      asset: "USDC",
      request_header: "PAYMENT-SIGNATURE",
      requirements_header: "PAYMENT-REQUIRED",
      response_header: "PAYMENT-RESPONSE",
    },
    when_stuck: { help_me: `${origin}/api/bar/x402/help-me` },
    survival_doors: survival,
    refinery_doors: standalone.filter((d) => d.refinery),
    specialist_doors: standalone.filter((d) => !d.refinery),
    proof: { ledger: `${origin}/api/bar/proof/payments` },
  };
}

export async function onRequestOptions() { return corsOptions("GET, POST, OPTIONS"); }
export async function onRequestGet(context) { return handle(context); }
export async function onRequestPost(context) { return handle(context); }

function handle(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  const product = {
    kind: "nano",
    id: TAP_SLUG,
    slug: TAP_SLUG,
    tool: TOOL_SLUG,
    tier: "nano",
    priceUsd: PRICE_USD,
    access: "paid",
    oneTime: true,
    description: DESCRIPTION,
    bazaarOutputSchema: {
      input: { type: "http", method: "GET", discoverable: true },
      output: { ...buildSurvivalKit(origin), access: "granted", scope: "nano" },
    },
  };
  return handlePaidFetch(context, product, async () => buildSurvivalKit(origin), async (token) => {
    const tab = await hasBarTabAccess(token, context.env);
    if (tab) return { ok: true, claims: tab };
    const toolClaims = await hasToolAccess(token, TOOL_SLUG, context.env);
    if (toolClaims) return { ok: true, claims: toolClaims };
    return consumeMicroAccess(token, TAP_SLUG, TOOL_SLUG, context.env);
  });
}
