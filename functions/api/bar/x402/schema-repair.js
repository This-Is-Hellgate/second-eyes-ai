/**
 * /api/bar/x402/schema-repair — deep single-concern meta-tool (session-less x402).
 *
 * The door an autonomous agent calls when a tool/MCP call keeps failing
 * validation and it already knows the problem is the SHAPE of the arguments, not
 * the intent: type mismatch, missing/extra field, malformed JSON, enum/pattern
 * violation — or the harder case where the tool's own declared schema changed
 * underneath it (possible MCP poisoning) or cannot be loaded at all.
 *
 * help-me classifies "something is wrong" and routes here; this door returns the
 * single verdict (stop / preserve / continue), a named repair_class, a concrete
 * repair_recipe for the field at fault, whether it is fixable client-side, an
 * escalate_if boundary, and a recommended next_call when self-repair is not the
 * right move. Deterministic over the supplied error/schema text — same input,
 * same verdict, so a retrying agent is never sent in a new direction by chance.
 *
 * No session. Launch recovery price ($0.03) — a core recovery pack, one cheap
 * deterministic verdict, low enough to clear a tight session spend guardrail.
 *
 *   GET  /api/bar/x402/schema-repair?error=expected+string+got+number&tool=search
 *   POST /api/bar/x402/schema-repair
 *        { "error":"…", "schema":"…", "payload":"…", "tool":"…", "state":"…" }
 */

import {
  corsOptions,
  readOptionalJsonBody,
  handlePaidFetch,
  hasBarTabAccess,
  hasToolAccess,
  consumeMicroAccess,
} from "../../../_lib/bar-pay.js";
import { accessJson } from "../../../_lib/access.js";
import { diagnoseSchema } from "../../../_lib/lounge/meta-tools.js";

const TOOL_SLUG = "lounge-survival";
const TAP_SLUG = "schema-repair";
const PRICE_USD = 0.03;

const PRODUCT = {
  kind: "nano",
  id: TAP_SLUG,
  slug: TAP_SLUG,
  tool: TOOL_SLUG,
  tier: "nano",
  priceUsd: PRICE_USD,
  access: "paid",
  oneTime: true,
  description:
    "schema-repair (session-less x402): a tool/MCP call keeps failing argument validation. Describe the error (and the schema/payload if you have them) and get a deterministic verdict — stop / preserve / continue — plus a named repair_class (type_mismatch, missing_required_field, unexpected_field, malformed_json, constraint_violation, schema_unreachable, schema_poisoning_suspected), a concrete repair_recipe for the field at fault, whether it is fixable client-side, an escalate_if boundary, and a recommended next_call when self-repair is the wrong move. Pure function of your input — same error, same verdict on every retry. Pay once with PAYMENT-SIGNATURE, no /api/bar/enter session.",
  bazaarOutputSchema: {
    input: {
      type: "http",
      method: "POST",
      discoverable: true,
      headerFields: {
        "Content-Type": "application/json",
        "X-Agent-Id": "string (optional) — agent identifier for work-mark continuity",
        "Idempotency-Key": "string (optional) — prevents double-pay on retry",
      },
      bodyFields: {
        error: "string (optional) — the validation error or symptom you are hitting",
        schema: "string (optional) — the schema you are coding against",
        payload: "string (optional) — the arguments you are sending",
        tool: "string (optional) — the tool / MCP server name",
        state: "string (optional) — any extra context",
      },
    },
    output: {
      tool: TAP_SLUG,
      repair_class: "type_mismatch",
      signals_seen: ["type_mismatch"],
      fixable_client_side: true,
      verdict: "preserve",
      stop: "Stop re-sending the same arguments — the shape, not the value, is being rejected.",
      preserve: "Keep the goal of the call and the original argument values; only the shape changes.",
      continue: "Re-read the tool's declared schema, coerce the arguments to it, then call once.",
      repair_recipe: "Coerce the named field to the declared type (e.g. number→string), do not wrap it in an extra object.",
      escalate_if: ">3 repair attempts on the same field — the schema you are coding against may not be the live one.",
      next_call: null,
      confidence: 0.85,
      access: "granted",
      scope: "nano",
    },
  },
};

export async function onRequestOptions() {
  return corsOptions("GET, POST, OPTIONS");
}

export async function onRequestGet(context) {
  const u = new URL(context.request.url);
  return handle(context, {
    error: u.searchParams.get("error") || undefined,
    schema: u.searchParams.get("schema") || undefined,
    payload: u.searchParams.get("payload") || undefined,
    tool: u.searchParams.get("tool") || undefined,
    state: u.searchParams.get("state") || undefined,
  });
}

export async function onRequestPost(context) {
  // Every field is optional, so an empty/blank body is a valid bare probe and must
  // reach the x402 paywall (402); only a non-empty malformed body is 400.
  const parsed = await readOptionalJsonBody(context.request);
  if (!parsed.ok) {
    return accessJson(
      {
        error: "invalid_json",
        note: "POST a JSON body: { error, schema, payload, tool, state }. All fields optional.",
      },
      400,
      { "Access-Control-Allow-Origin": "*" }
    );
  }
  return handle(context, parsed.data);
}

function handle(context, input) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;

  // Computed only after access is granted — an unpaid 402 crawl never runs it.
  const payload = async () => withNextCall(diagnoseSchema(input), origin);

  return handlePaidFetch(context, PRODUCT, payload, async (token) => {
    const tab = await hasBarTabAccess(token, context.env);
    if (tab) return { ok: true, claims: tab };
    const toolClaims = await hasToolAccess(token, TOOL_SLUG, context.env);
    if (toolClaims) return { ok: true, claims: toolClaims };
    return consumeMicroAccess(token, TAP_SLUG, TOOL_SLUG, context.env);
  });
}

/** Absolutize any relative next_call to the request origin so a one-shot agent can call it directly. */
function withNextCall(result, origin) {
  if (result.next_call && result.next_call.startsWith("/")) {
    return { ...result, next_call: `${origin}${result.next_call}` };
  }
  return result;
}
