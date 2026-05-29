/**
 * bazaar-index-check — is an x402 endpoint actually indexed on the CDP Bazaar,
 * and if not, is it a format problem or CDP's indexing backlog?
 *
 * Uses the public CDP discovery API (no auth):
 *   GET /platform/v2/x402/discovery/merchant?payTo=0x…   (authoritative per-wallet)
 *   GET /platform/v2/x402/discovery/search?query=<host>  (keyword/host search)
 *
 * When not found and a URL is given, it fetches the live 402 and runs the
 * x402-doctor engine to disambiguate "your format won't index" from
 * "your format is clean, this is CDP lag / no settlement yet".
 */

import { fetchWithTimeout, DEFAULT_FETCH_TIMEOUT_MS } from "./resilience.js";
import { diagnose402 } from "./x402-doctor.js";
import { isSafeHttpUrl } from "./url-guard.js";

const CDP_DISCOVERY = "https://api.cdp.coinbase.com/platform/v2/x402/discovery";

function normUrl(u) {
  try {
    const x = new URL(u);
    return (x.host + x.pathname).toLowerCase().replace(/\/$/, "");
  } catch {
    return String(u || "").toLowerCase();
  }
}

function normHost(u) {
  try {
    return new URL(u).host.toLowerCase();
  } catch {
    return "";
  }
}

async function cdpJson(path) {
  try {
    const res = await fetchWithTimeout(
      `${CDP_DISCOVERY}${path}`,
      { headers: { Accept: "application/json" } },
      DEFAULT_FETCH_TIMEOUT_MS
    );
    if (!res.ok) return { ok: false, status: res.status };
    const body = await res.json().catch(() => null);
    return { ok: true, status: res.status, body };
  } catch {
    return { ok: false, status: 0, error: "fetch_failed" };
  }
}

function summarizeMatch(r) {
  return { resource: r.resource, quality: r.quality, lastUpdated: r.lastUpdated };
}

export async function checkBazaarIndex({ payTo, url }) {
  const result = {
    tool: "bazaar-index-check",
    indexed: false,
    where: [],
    matches: [],
    queried: {},
  };
  const targetUrl = url ? normUrl(url) : null;

  // 1) Authoritative: list everything indexed for this wallet.
  if (payTo) {
    const m = await cdpJson(`/merchant?payTo=${encodeURIComponent(payTo)}`);
    if (m.ok && Array.isArray(m.body?.resources)) {
      const all = m.body.resources;
      result.queried.merchant = all.length;
      result.wallet_resource_count = all.length;
      const hit = targetUrl ? all.filter((r) => normUrl(r.resource) === targetUrl) : all;
      if (hit.length) {
        result.indexed = true;
        result.where.push("cdp_merchant");
        result.matches.push(...hit.map(summarizeMatch));
      }
    } else {
      result.queried.merchant = `error_${m.status}`;
    }
  }

  // 2) Host search (when a URL is given and the wallet lookup didn't confirm it).
  if (url && !result.indexed) {
    const host = normHost(url);
    const s = await cdpJson(`/search?query=${encodeURIComponent(host)}`);
    if (s.ok && Array.isArray(s.body?.resources)) {
      result.queried.search = s.body.resources.length;
      const hit = s.body.resources.filter(
        (r) => normUrl(r.resource) === targetUrl || normHost(r.resource) === host
      );
      if (hit.length) {
        result.indexed = true;
        result.where.push("cdp_search");
        result.matches.push(...hit.map(summarizeMatch));
      }
    } else {
      result.queried.search = `error_${s.status}`;
    }
  }

  // 3) Verdict + reason.
  if (result.indexed) {
    result.detail = "Indexed on the CDP x402 Bazaar.";
    return result;
  }

  if (url && isSafeHttpUrl(url)) {
    const diag = await fetchAndDiagnose(url);
    result.live_402 = diag.summary;
    if (diag.report && diag.report.indexable === false) {
      result.reason = "format";
      result.detail = "The endpoint's 402 is not v2-indexable, so the crawler skips it.";
      result.doctor_grade = diag.report.grade;
      result.next_step = "Run x402-doctor on this URL, apply the corrected payload, redeploy, then settle once.";
      result.x402_doctor = `/api/bar/x402/doctor?url=${encodeURIComponent(url)}`;
    } else if (diag.report && diag.report.indexable === true) {
      result.reason = "backlog_or_no_settlement";
      result.detail =
        "Your 402 is clean v2 but it isn't in the index. CDP indexes on a settled payment and lags; confirm at least one settlement happened after your last deploy.";
      result.next_step = "Settle one real payment against the endpoint, then re-check in 24-72h.";
    } else {
      result.reason = "no_402";
      result.detail = "The endpoint did not return a parseable HTTP 402 JSON body.";
      result.next_step = "Confirm a bare request returns HTTP 402 with a JSON payment-required body, then run x402-doctor.";
    }
  } else if (payTo) {
    result.reason = "not_found_for_wallet";
    result.detail = "No resources indexed for this wallet.";
    result.next_step = "Pass ?url= to diagnose format vs backlog, or settle a payment to trigger indexing.";
  } else {
    result.reason = "no_input";
    result.detail = "Provide ?payTo= (wallet) and/or ?url= (endpoint) to check.";
  }

  return result;
}

async function fetchAndDiagnose(url) {
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { Accept: "application/json" } },
      DEFAULT_FETCH_TIMEOUT_MS
    );
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (!body) return { summary: { status: res.status, json: false } };
    const report = diagnose402(body, { sourceUrl: url });
    return {
      summary: { status: res.status, was_402: res.status === 402, grade: report.grade, indexable: report.indexable },
      report,
    };
  } catch {
    return { summary: { error: "fetch_failed" } };
  }
}
