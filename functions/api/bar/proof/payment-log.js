import { accessJson } from "../../../_lib/access.js";
import { corsOptions } from "../../../_lib/bar-pay.js";
import { SERVICE_ID, SERVICE_NAME } from "../../../_lib/brand.js";
import {
  listX402PaymentAttempts,
  parseSinceFilter,
} from "../../../_lib/x402-payment-log.js";

export async function onRequestOptions() {
  return corsOptions();
}

/**
 * Public funnel dashboard — recent x402 payment attempts (sanitized wallets).
 *
 *   GET /api/bar/proof/payment-log
 *   GET /api/bar/proof/payment-log?limit=50
 *   GET /api/bar/proof/payment-log?since=24h
 */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") || "50", 10);
  const sinceRaw = url.searchParams.get("since");
  const since = parseSinceFilter(sinceRaw);

  if (sinceRaw && !since) {
    return accessJson(
      {
        error: "bad_since",
        note: "Use ISO timestamp or relative window: 1h, 24h, 7d",
        provided: sinceRaw,
      },
      400,
      { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }
    );
  }

  const result = await listX402PaymentAttempts(context.env, { limit, since });

  if (!result.ok) {
    return accessJson(
      {
        service: SERVICE_ID,
        probe: "payment_log",
        pass: false,
        reason: result.reason,
        attempts: [],
      },
      503,
      { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }
    );
  }

  return accessJson(
    {
      service: SERVICE_ID,
      name: SERVICE_NAME,
      probe: "payment_log",
      pass: true,
      since: since || null,
      since_filter: sinceRaw || null,
      limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
      summary: result.summary,
      attempts: result.attempts,
      schema_probe: `${url.origin}/api/bar/proof/d1-schema`,
      payment_ledger: `${url.origin}/api/bar/proof/payments`,
    },
    200,
    { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=15" }
  );
}
