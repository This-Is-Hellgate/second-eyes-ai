import { accessJson } from "../../../_lib/access.js";
import { corsOptions } from "../../../_lib/bar-pay.js";
import { checkX402PaymentLogTable } from "../../../_lib/x402-payment-log.js";

export async function onRequestOptions() {
  return corsOptions();
}

/** D1 schema probe — ensures x402_payment_attempts exists and reports sqlite_master confirmation. */
export async function onRequestGet(context) {
  const { env } = context;
  const check = await checkX402PaymentLogTable(env);
  return accessJson(
    {
      probe: "d1_schema",
      query: "SELECT name FROM sqlite_master WHERE type='table' AND name='x402_payment_attempts'",
      x402_payment_attempts: check.exists,
      table: check.table,
      pass: check.exists,
    },
    check.exists ? 200 : 503,
    { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }
  );
}
