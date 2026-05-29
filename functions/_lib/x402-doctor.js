/**
 * x402-doctor — grade any x402 "402 Payment Required" response for CDP Bazaar
 * v2 indexing compliance and emit the exact corrected payload.
 *
 * Pure and deterministic: give it a parsed 402 body, get back a scored report +
 * a ready-to-paste corrected body. No network calls happen here — the caller
 * fetches a live URL if needed.
 *
 * CHAIN-AWARE: the x402 ecosystem spans EVM (eip155, EIP-712 USDC) and Solana
 * (base58 mints, no EIP-712). Checks are gated by the declared CAIP-2 namespace
 * so a healthy Solana endpoint is not falsely failed for lacking an EVM domain.
 *
 * Failure modes encoded below are the exact ones reported in coinbase/x402#1461
 * and the CDP discovery docs / bazaar.md spec:
 *   - v1-shaped responses never index (must be x402Version: 2)
 *   - non-CAIP-2 network (legacy "base" instead of "eip155:8453")
 *   - missing EIP-712 domain on EVM (extra.name/version) → silent mainnet fails
 *   - v1 metadata (resource/description/mimeType/outputSchema) polluting accepts[]
 *   - missing/malformed resource (spec v2 uses resource:{url,description,mimeType})
 *   - missing extensions.bazaar query-discovery block
 */

const KNOWN_USDC = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { name: "USD Coin", version: "2", network: "eip155:8453" },
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e": { name: "USDC", version: "2", network: "eip155:84532" },
};

const NETWORK_CAIP2 = {
  base: "eip155:8453",
  "base-mainnet": "eip155:8453",
  "base-sepolia": "eip155:84532",
  "eip155:8453": "eip155:8453",
  "eip155:84532": "eip155:84532",
};

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const SEVERITY_WEIGHT = { critical: 3, warning: 2, info: 1 };

const V1_CONTAMINANTS = ["resource", "description", "mimeType", "outputSchema"];

function parseCaip2(network) {
  const m = String(network || "").match(/^([-a-z0-9]{3,8}):([-_a-zA-Z0-9]{1,32})$/);
  return m ? { namespace: m[1], reference: m[2] } : null;
}

function namespaceOf(accept) {
  const c = parseCaip2(accept?.network);
  return c ? c.namespace : null;
}

function isValidAddressFor(namespace, addr) {
  const a = String(addr || "");
  if (!a) return false;
  if (namespace === "eip155") return EVM_ADDRESS_RE.test(a);
  if (namespace === "solana") return SOLANA_ADDRESS_RE.test(a);
  // Unknown namespace: accept any plausible non-empty token rather than false-fail.
  return a.length >= 16;
}

/** v2 spec allows resource as a string OR an object {url, description, mimeType}. */
function resourceUrlOf(body) {
  const r = body?.resource;
  if (typeof r === "string") return r;
  if (r && typeof r === "object" && typeof r.url === "string") return r.url;
  return "";
}

function resourceDescriptionOf(body) {
  const r = body?.resource;
  if (r && typeof r === "object" && r.description) return r.description;
  return body?.description || "";
}

function resourceMimeTypeOf(body) {
  const r = body?.resource;
  if (r && typeof r === "object" && r.mimeType) return r.mimeType;
  return body?.mimeType || "";
}

function normalizeAccepts(body) {
  if (!body || typeof body !== "object") return [];
  if (Array.isArray(body.accepts)) return body.accepts;
  if (body.paymentRequirements) {
    return Array.isArray(body.paymentRequirements) ? body.paymentRequirements : [body.paymentRequirements];
  }
  if (body.scheme || body.payTo || body.asset) return [body];
  return [];
}

function detectVersion(body, accepts) {
  if (body && Number(body.x402Version) === 2) return 2;
  if (body && Number(body.x402Version) === 1) return 1;
  const contaminated = accepts.some(
    (a) => a && typeof a === "object" && V1_CONTAMINANTS.some((k) => k in a)
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
 */
export function diagnose402(body, opts = {}) {
  const checks = [];
  const accepts = normalizeAccepts(body);
  const version = detectVersion(body, accepts);
  const accept = accepts[0] || {};
  const hasAccepts = Array.isArray(accepts) && accepts.length > 0;

  function firstFail(predicate) {
    for (let i = 0; i < accepts.length; i++) {
      if (!predicate(accepts[i] || {})) return i;
    }
    return -1;
  }

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

  // ---- resource (string OR {url,description,mimeType}) ----
  const resourceUrl = resourceUrlOf(body);
  const resourceAbs = /^https:\/\//.test(resourceUrl);
  checks.push(
    check(
      "resource_url",
      "resource is an absolute https URL (string or {url})",
      "critical",
      resourceAbs,
      resourceAbs
        ? ""
        : resourceUrl
        ? `resource "${resourceUrl}" is not an absolute https URL. The indexer catalogs by callable URL.`
        : "Missing resource. v2 uses top-level resource (string, or { url, description, mimeType }).",
      resourceAbs ? null : `Set resource: { "url": "${opts.sourceUrl || "https://your-host/your/path"}", "description": "...", "mimeType": "application/json" }`
    )
  );

  checks.push(
    check(
      "description",
      "A description is present (top-level or resource.description)",
      "info",
      Boolean(resourceDescriptionOf(body)),
      resourceDescriptionOf(body) ? "" : "A human/agent-readable description improves discovery relevance and quality score.",
      resourceDescriptionOf(body) ? null : "Add a description (resource.description or top-level)"
    )
  );

  // ---- accept-level ----
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

  const netBad = firstFail((a) => parseCaip2(a.network) !== null);
  const legacyNet = accept.network && !parseCaip2(accept.network);
  checks.push(
    check(
      "accept_network",
      "accepts[].network is CAIP-2 (namespace:reference)",
      "critical",
      hasAccepts && netBad === -1,
      netBad >= 0
        ? `accepts[${netBad}].network is "${accepts[netBad]?.network}". CDP requires CAIP-2 — e.g. eip155:8453 (Base) or solana:5eyk… (Solana).`
        : "",
      legacyNet ? `Use CAIP-2, e.g. "${NETWORK_CAIP2[String(accept.network).toLowerCase()] || "eip155:8453"}"` : null
    )
  );

  const assetBad = firstFail((a) => isValidAddressFor(namespaceOf(a), a.asset));
  checks.push(
    check(
      "accept_asset",
      "accepts[].asset is a valid token address for its chain",
      "critical",
      hasAccepts && assetBad === -1,
      assetBad >= 0
        ? `accepts[${assetBad}].asset "${accepts[assetBad]?.asset}" is not valid for network ${accepts[assetBad]?.network}.`
        : "",
      assetBad >= 0 ? "Set asset to the token contract (EVM 0x…) or mint (Solana base58) for the declared network" : null
    )
  );

  const payToBad = firstFail((a) => isValidAddressFor(namespaceOf(a), a.payTo));
  checks.push(
    check(
      "accept_payto",
      "accepts[].payTo is a valid address for its chain",
      "critical",
      hasAccepts && payToBad === -1,
      payToBad >= 0
        ? `accepts[${payToBad}].payTo "${accepts[payToBad]?.payTo}" is not valid for network ${accepts[payToBad]?.network}.`
        : "",
      payToBad >= 0 ? "Set payTo to your receiving address on the declared network" : null
    )
  );

  const amountBad = firstFail((a) => /^\d+$/.test(String(a.amount ?? a.maxAmountRequired ?? "")));
  checks.push(
    check(
      "accept_amount",
      "accepts[].amount is an integer (smallest-unit string)",
      "critical",
      hasAccepts && amountBad === -1,
      amountBad >= 0 ? `accepts[${amountBad}] has no integer amount (USDC has 6 decimals → $1 = "1000000").` : "",
      amountBad >= 0 ? 'Set amount as a smallest-unit string, e.g. "1000000" for $1.00 USDC' : null
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

  // ---- EIP-712 domain: EVM (eip155) only ----
  const evmAccepts = accepts.filter((a) => namespaceOf(a) === "eip155");
  if (evmAccepts.length) {
    const domainBad = evmAccepts.findIndex((a) => !(a.extra && a.extra.name && a.extra.version));
    checks.push(
      check(
        "accept_eip712_domain",
        "EVM accepts[].extra has EIP-712 domain (name + version)",
        "critical",
        domainBad === -1,
        domainBad >= 0
          ? "Missing extra.{name,version} on an eip155 entry. Without the EIP-712 domain, USDC payments fail silently on EVM mainnet."
          : "",
        domainBad >= 0 ? 'Add extra: { "name": "USD Coin", "version": "2" } to the EVM/USDC entry' : null
      )
    );
  } else {
    checks.push(
      check(
        "accept_eip712_domain",
        "EIP-712 domain (EVM only) — not applicable",
        "info",
        true,
        hasAccepts ? "Non-EVM network; EIP-712 domain not required." : ""
      )
    );
  }

  const contaminated = firstFail((a) => !V1_CONTAMINANTS.some((k) => k in (a || {})));
  checks.push(
    check(
      "accept_clean",
      "accepts[] contains no v1 metadata fields",
      "warning",
      hasAccepts && contaminated === -1,
      contaminated >= 0
        ? `accepts[${contaminated}] contains v1 fields (${V1_CONTAMINANTS.filter((k) => k in (accepts[contaminated] || {})).join(", ")}). The CDP indexer expects clean accepts[]; metadata belongs in top-level resource + extensions.bazaar.`
        : "",
      contaminated >= 0 ? "Move resource/description/mimeType/outputSchema out of accepts[] (resource object + extensions.bazaar)" : null
    )
  );

  const hasBazaar = Boolean(body?.extensions?.bazaar?.info);
  checks.push(
    check(
      "extensions_bazaar",
      "extensions.bazaar present for discovery cataloging",
      "warning",
      hasBazaar,
      hasBazaar ? "" : "No extensions.bazaar block. Indexing is settle-driven and the client echoes this extension; without it, cataloging will not occur.",
      hasBazaar ? null : "Attach extensions.bazaar.info { input, output } so the service can be cataloged on settle"
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
    chain: namespaceOf(accept) || "unknown",
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
    return "Clean v2 response. Eligible for CDP Bazaar cataloging on next settled payment.";
  }
  const parts = [];
  if (version === 1) parts.push("This is x402 v1 — it will not index on the Bazaar");
  parts.push(`${criticalCount} blocking issue${criticalCount === 1 ? "" : "s"}`);
  if (warningCount) parts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
  parts.push(`grade ${grade} (${score}/100)`);
  parts.push("Apply the corrected payload below, redeploy, then settle one payment to trigger cataloging");
  return parts.join(". ") + ".";
}

/** Best-effort corrected v2 body (resource as the spec-canonical object form). */
function buildCorrected(body, accepts, opts) {
  const src = accepts[0] || {};
  const caip = parseCaip2(src.network);
  const namespace = caip ? caip.namespace : "eip155";
  const networkRaw = String(src.network || "").toLowerCase();
  const network = caip ? src.network : NETWORK_CAIP2[networkRaw] || "eip155:8453";
  const amount = String(src.amount ?? src.maxAmountRequired ?? body?.maxAmountRequired ?? "") || "1000000";
  const known = KNOWN_USDC[String(src.asset || "").toLowerCase()];
  const url =
    /^https:\/\//.test(resourceUrlOf(body)) ? resourceUrlOf(body) : opts.sourceUrl || "https://your-host/your/path";

  const accept = {
    scheme: "exact",
    network,
    asset: src.asset || (namespace === "eip155" ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913" : "YourTokenMintOrContract"),
    amount,
    payTo: src.payTo || "YourReceivingAddress",
    maxTimeoutSeconds: Number(src.maxTimeoutSeconds) > 0 ? Number(src.maxTimeoutSeconds) : 600,
  };
  if (namespace === "eip155") {
    accept.extra =
      src.extra && src.extra.name && src.extra.version
        ? { name: src.extra.name, version: String(src.extra.version) }
        : { name: known?.name || "USD Coin", version: known?.version || "2" };
  } else if (src.extra) {
    accept.extra = src.extra;
  }

  return {
    x402Version: 2,
    resource: {
      url,
      description: resourceDescriptionOf(body) || "Your service description",
      mimeType: resourceMimeTypeOf(body) || "application/json",
    },
    accepts: [accept],
  };
}
