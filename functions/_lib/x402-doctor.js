/**
 * x402-doctor — grade any x402 "402 Payment Required" response for CDP Bazaar
 * v2 indexing compliance and emit the exact corrected payload.
 *
 * This is the productized version of the audit Second Eyes ran on its own
 * endpoint during the v2 migration. It is pure and deterministic: give it a
 * parsed 402 body, get back a scored report + a ready-to-paste corrected body.
 * No network calls happen here — the caller fetches a live URL if needed.
 *
 * The failure modes encoded below are the exact ones reported, repeatedly, in
 * coinbase/x402#1461 and the CDP discovery docs:
 *   - v1-shaped responses never index (must be x402Version: 2)
 *   - legacy network "base" instead of CAIP-2 "eip155:8453"
 *   - missing EIP-712 domain (extra.name / extra.version) → silent mainnet fails
 *   - v1 metadata (resource/description/mimeType/outputSchema) polluting accepts[]
 *   - missing top-level discovery fields the indexer reads
 *   - missing extensions.bazaar query-discovery block
 */

const KNOWN_USDC = {
  // Base mainnet USDC
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { name: "USD Coin", version: "2", network: "eip155:8453" },
  // Base Sepolia USDC (testnet)
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e": { name: "USDC", version: "2", network: "eip155:84532" },
};

const NETWORK_CAIP2 = {
  base: "eip155:8453",
  "base-mainnet": "eip155:8453",
  "base-sepolia": "eip155:84532",
  "eip155:8453": "eip155:8453",
  "eip155:84532": "eip155:84532",
};

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const CAIP2_RE = /^eip155:\d+$/;

const SEVERITY_WEIGHT = { critical: 3, warning: 2, info: 1 };

/** Pull the accepts[] array out of whatever 402 shape we were handed. */
function normalizeAccepts(body) {
  if (!body || typeof body !== "object") return [];
  if (Array.isArray(body.accepts)) return body.accepts;
  // Some v1 servers used a single/array paymentRequirements field instead.
  if (body.paymentRequirements) {
    return Array.isArray(body.paymentRequirements)
      ? body.paymentRequirements
      : [body.paymentRequirements];
  }
  // Last resort: a bare single requirement object at the top level.
  if (body.scheme || body.payTo || body.asset) return [body];
  return [];
}

/** Fields that belong top-level in v2 but the CDP indexer rejects inside accepts[]. */
const V1_CONTAMINANTS = ["resource", "description", "mimeType", "outputSchema"];

function detectVersion(body, accepts) {
  if (body && Number(body.x402Version) === 2) return 2;
  if (body && Number(body.x402Version) === 1) return 1;
  // No explicit version — infer from shape. v1 hallmark: metadata inside accepts.
  const contaminated = accepts.some((a) =>
    a && typeof a === "object" && V1_CONTAMINANTS.some((k) => k in a)
  );
  return contaminated ? 1 : null;
}

function check(id, label, severity, ok, detail, fix) {
  return { id, label, severity, status: ok ? "pass" : "fail", detail: detail || "", ...(fix ? { fix } : {}) };
}

/**
 * Diagnose a parsed 402 body.
 * @param {object} body - parsed JSON of the 402 response.
 * @param {object} [opts]
 * @param {string} [opts.sourceUrl] - the URL the 402 came from (for resource checks).
 * @returns {{ score, grade, version, checks, criticalCount, warningCount, corrected, summary, indexable }}
 */
export function diagnose402(body, opts = {}) {
  const checks = [];
  const accepts = normalizeAccepts(body);
  const version = detectVersion(body, accepts);
  const accept = accepts[0] || {};

  // ---- version ----
  checks.push(
    check(
      "x402_version",
      "x402Version is 2",
      "critical",
      version === 2,
      version === 1
        ? "Response is x402 v1. CDP Bazaar only indexes v2-shaped responses."
        : version === null
        ? "No x402Version field and shape is ambiguous; set x402Version: 2."
        : "",
      version !== 2 ? 'Set top-level "x402Version": 2' : null
    )
  );

  // ---- accepts presence ----
  const hasAccepts = Array.isArray(accepts) && accepts.length > 0;
  checks.push(
    check(
      "accepts_present",
      "accepts[] is a non-empty array",
      "critical",
      hasAccepts,
      hasAccepts ? "" : "No accepts[] array found. v2 requires accepts[] with at least one payment option.",
      hasAccepts ? null : 'Provide "accepts": [ { scheme, network, asset, amount, payTo, ... } ]'
    )
  );

  // ---- top-level discovery fields ----
  const resource = typeof body?.resource === "string" ? body.resource : "";
  const resourceAbs = /^https:\/\//.test(resource);
  checks.push(
    check(
      "top_resource",
      "Top-level resource is an absolute https URL",
      "critical",
      resourceAbs,
      resourceAbs
        ? ""
        : resource
        ? `resource "${resource}" is not an absolute https URL. The indexer catalogs by callable URL.`
        : "Missing top-level resource. The indexer catalogs the service by this URL.",
      resourceAbs ? null : `Set top-level "resource": "${opts.sourceUrl || "https://your-host/your/path"}"`
    )
  );

  checks.push(
    check(
      "top_max_amount",
      "Top-level maxAmountRequired present",
      "warning",
      body?.maxAmountRequired != null,
      body?.maxAmountRequired != null ? "" : "Indexers read maxAmountRequired at the top level.",
      body?.maxAmountRequired != null ? null : 'Mirror the price as top-level "maxAmountRequired" (micros string)'
    )
  );

  checks.push(
    check(
      "top_description",
      "Top-level description present",
      "info",
      Boolean(body?.description),
      body?.description ? "" : "A human/agent-readable description improves discovery quality.",
      body?.description ? null : 'Add a top-level "description"'
    )
  );

  // ---- accept-level checks (validate ALL, report on first failure) ----
  function firstFail(predicate) {
    for (let i = 0; i < accepts.length; i++) {
      if (!predicate(accepts[i] || {})) return i;
    }
    return -1;
  }

  const schemeBad = firstFail((a) => a.scheme === "exact");
  checks.push(
    check(
      "accept_scheme",
      'accepts[].scheme is "exact"',
      "critical",
      hasAccepts && schemeBad === -1,
      schemeBad >= 0 ? `accepts[${schemeBad}].scheme is "${accepts[schemeBad]?.scheme}" (expected "exact").` : "",
      schemeBad >= 0 ? 'Set scheme: "exact"' : null
    )
  );

  const netBad = firstFail((a) => CAIP2_RE.test(String(a.network || "")));
  const legacyNet = accept.network && !CAIP2_RE.test(String(accept.network));
  checks.push(
    check(
      "accept_network",
      "accepts[].network is CAIP-2 (eip155:NNNN)",
      "critical",
      hasAccepts && netBad === -1,
      netBad >= 0
        ? `accepts[${netBad}].network is "${accepts[netBad]?.network}". CDP requires CAIP-2 (e.g. eip155:8453 for Base).`
        : "",
      legacyNet ? `Convert "${accept.network}" → "${NETWORK_CAIP2[String(accept.network).toLowerCase()] || "eip155:8453"}"` : null
    )
  );

  const assetBad = firstFail((a) => ADDRESS_RE.test(String(a.asset || "")));
  checks.push(
    check(
      "accept_asset",
      "accepts[].asset is a token contract address",
      "critical",
      hasAccepts && assetBad === -1,
      assetBad >= 0 ? `accepts[${assetBad}].asset "${accepts[assetBad]?.asset}" is not a 0x… contract address.` : "",
      assetBad >= 0 ? "Set asset to the ERC-20 contract (USDC on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913)" : null
    )
  );

  const payToBad = firstFail((a) => ADDRESS_RE.test(String(a.payTo || "")));
  checks.push(
    check(
      "accept_payto",
      "accepts[].payTo is a valid address",
      "critical",
      hasAccepts && payToBad === -1,
      payToBad >= 0 ? `accepts[${payToBad}].payTo "${accepts[payToBad]?.payTo}" is not a 0x… address.` : "",
      payToBad >= 0 ? "Set payTo to your receiving wallet address" : null
    )
  );

  const amountBad = firstFail((a) => /^\d+$/.test(String(a.amount ?? a.maxAmountRequired ?? "")));
  checks.push(
    check(
      "accept_amount",
      "accepts[].amount is an integer micros string",
      "critical",
      hasAccepts && amountBad === -1,
      amountBad >= 0 ? `accepts[${amountBad}] has no integer amount (USDC has 6 decimals → $1 = "1000000").` : "",
      amountBad >= 0 ? 'Set amount as a micros string, e.g. "1000000" for $1.00' : null
    )
  );

  const timeoutBad = firstFail((a) => Number.isFinite(Number(a.maxTimeoutSeconds)) && Number(a.maxTimeoutSeconds) > 0);
  checks.push(
    check(
      "accept_timeout",
      "accepts[].maxTimeoutSeconds present",
      "warning",
      hasAccepts && timeoutBad === -1,
      timeoutBad >= 0 ? "Missing maxTimeoutSeconds; facilitators may reject or apply a short default." : "",
      timeoutBad >= 0 ? "Set maxTimeoutSeconds (e.g. 600)" : null
    )
  );

  const domainBad = firstFail((a) => a.extra && a.extra.name && a.extra.version);
  checks.push(
    check(
      "accept_eip712_domain",
      "accepts[].extra has EIP-712 domain (name + version)",
      "critical",
      hasAccepts && domainBad === -1,
      domainBad >= 0
        ? "Missing extra.{name,version}. Without the EIP-712 domain, USDC payments fail silently on mainnet."
        : "",
      domainBad >= 0 ? 'Add extra: { "name": "USD Coin", "version": "2" } (USDC on Base)' : null
    )
  );

  const contaminated = firstFail((a) => !V1_CONTAMINANTS.some((k) => k in (a || {})));
  checks.push(
    check(
      "accept_clean",
      "accepts[] contains no v1 metadata fields",
      "warning",
      hasAccepts && contaminated === -1,
      contaminated >= 0
        ? `accepts[${contaminated}] contains v1 fields (${V1_CONTAMINANTS.filter((k) => k in (accepts[contaminated] || {})).join(", ")}). The CDP indexer rejects accepts[] polluted with v1 metadata.`
        : "",
      contaminated >= 0 ? "Move resource/description/mimeType/outputSchema to the top level; keep accepts[] entries clean" : null
    )
  );

  const hasBazaar = Boolean(body?.extensions?.bazaar?.info);
  checks.push(
    check(
      "extensions_bazaar",
      "extensions.bazaar present for query discovery",
      "warning",
      hasBazaar,
      hasBazaar ? "" : "No extensions.bazaar block. Settlement can still index, but query/search discovery is weaker without it.",
      hasBazaar ? null : "Attach extensions.bazaar.info { input, output } so the service is searchable"
    )
  );

  // ---- score ----
  let totalWeight = 0;
  let passWeight = 0;
  let criticalCount = 0;
  let warningCount = 0;
  for (const c of checks) {
    const w = SEVERITY_WEIGHT[c.severity] || 1;
    totalWeight += w;
    if (c.status === "pass") passWeight += w;
    else if (c.severity === "critical") criticalCount++;
    else if (c.severity === "warning") warningCount++;
  }
  const score = totalWeight ? Math.round((100 * passWeight) / totalWeight) : 0;
  const grade = score >= 95 ? "A" : score >= 85 ? "B" : score >= 70 ? "C" : score >= 50 ? "D" : "F";
  const indexable = criticalCount === 0;

  const corrected = buildCorrected(body, accepts, opts);
  const summary = buildSummary({ version, score, grade, indexable, criticalCount, warningCount });

  return {
    tool: "x402-doctor",
    version,
    score,
    grade,
    indexable,
    criticalCount,
    warningCount,
    checks,
    corrected,
    summary,
  };
}

function buildSummary({ version, score, grade, indexable, criticalCount, warningCount }) {
  if (indexable && score >= 95) {
    return "Clean v2 response. Eligible for CDP Bazaar indexing on next settlement.";
  }
  const parts = [];
  if (version === 1) parts.push("This is x402 v1 — it will not index on the Bazaar");
  parts.push(`${criticalCount} blocking issue${criticalCount === 1 ? "" : "s"}`);
  if (warningCount) parts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
  parts.push(`grade ${grade} (${score}/100)`);
  parts.push("Apply the corrected payload below, redeploy, then settle one payment to trigger indexing");
  return parts.join(". ") + ".";
}

/** Best-effort corrected v2 body using whatever inputs were valid. */
function buildCorrected(body, accepts, opts) {
  const src = accepts[0] || {};
  const assetRaw = String(src.asset || "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913");
  const known = KNOWN_USDC[assetRaw.toLowerCase()];
  const networkRaw = String(src.network || "").toLowerCase();
  const network = NETWORK_CAIP2[networkRaw] || known?.network || "eip155:8453";
  const amount = String(src.amount ?? src.maxAmountRequired ?? body?.maxAmountRequired ?? "");
  const resource =
    (typeof body?.resource === "string" && /^https:\/\//.test(body.resource) && body.resource) ||
    opts.sourceUrl ||
    "https://your-host/your/path";

  const accept = {
    scheme: "exact",
    network,
    asset: assetRaw,
    amount: amount || "1000000",
    payTo: src.payTo || "0xYourReceivingWallet",
    maxTimeoutSeconds: Number(src.maxTimeoutSeconds) > 0 ? Number(src.maxTimeoutSeconds) : 600,
    extra:
      src.extra && src.extra.name && src.extra.version
        ? { name: src.extra.name, version: String(src.extra.version) }
        : { name: known?.name || "USD Coin", version: known?.version || "2" },
  };

  return {
    x402Version: 2,
    resource,
    description: body?.description || "Your service description",
    mimeType: body?.mimeType || "application/json",
    maxAmountRequired: amount || "1000000",
    accepts: [accept],
  };
}
