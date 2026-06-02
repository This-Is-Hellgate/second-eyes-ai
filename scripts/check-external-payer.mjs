#!/usr/bin/env node
/**
 * READ-ONLY external-payer check. Fetches the public payment ledger and reports
 * whether any x402 settlement has arrived from an external agent payer — i.e. a
 * payer outside the known operator/test wallet set (configured server-side via
 * KNOWN_TEST_PAYERS; see docs/external-payer-monitoring.md).
 *
 * No spend, no writes, no notifications. Designed for cron / pipe-to-notify:
 *
 *   node scripts/check-external-payer.mjs                 # default prod host
 *   BASE=https://second-eyes.ai node scripts/check-external-payer.mjs
 *   node scripts/check-external-payer.mjs --json          # machine output only
 *
 * Exit codes:
 *   0  — an external agent payer is present (external_buyer_signal=true)
 *   1  — no external payer yet (only known operator/test wallets have settled)
 *   2  — fetch/parse error (endpoint unreachable, bad JSON, etc.)
 *
 * The 0/1 split is deliberate so a cron wrapper can fire a notification only on
 * the first transition to "external payer seen":
 *   node scripts/check-external-payer.mjs && notify "external agent payer!"
 */

const BASE = (process.env.BASE || "https://second-eyes.ai").replace(/\/$/, "");
const JSON_ONLY = process.argv.includes("--json");
const URL = `${BASE}/api/bar/proof/payments`;

function out(obj) {
  console.log(JSON.stringify(obj, null, JSON_ONLY ? 0 : 2));
}

async function main() {
  let res;
  try {
    res = await fetch(URL, { headers: { accept: "application/json" } });
  } catch (e) {
    out({ ok: false, error: "fetch_failed", detail: e.message, url: URL });
    process.exit(2);
  }
  if (!res.ok) {
    out({ ok: false, error: "http_status", status: res.status, url: URL });
    process.exit(2);
  }

  let body;
  try {
    body = await res.json();
  } catch (e) {
    out({ ok: false, error: "bad_json", detail: e.message, url: URL });
    process.exit(2);
  }

  const sig = body.external_payer_signal || {};
  const external = Boolean(sig.external_buyer_signal);

  out({
    ok: true,
    url: URL,
    external_buyer_signal: external,
    external_distinct_payers: sig.external_distinct_payers || 0,
    first_external_payer_seen: sig.first_external_payer_seen || null,
    latest_external_settlement: sig.latest_external_settlement || null,
    known_test_payers_configured: sig.known_test_payers_configured || 0,
    payments_settled: body.payments_settled ?? null,
    x402_settled: body.x402_settled ?? null,
  });

  process.exit(external ? 0 : 1);
}

main();
