#!/usr/bin/env node
// scripts/x402-header-size-selftest.mjs
// Zero-spend, no-network proof that every paid x402 route emits a PAYMENT-REQUIRED
// header small enough to survive real intermediaries, while keeping its rich Bazaar
// metadata in the 402 JSON body where the indexer actually reads it.
//
// WHY THIS EXISTS: the PAYMENT-REQUIRED header is a single HTTP header line. Common
// intermediaries cap one header well below where a body would be trimmed —
// nginx large_client_header_buffers defaults to 8KB/line, Node's HTTP parser caps
// the WHOLE header block at 16KB, and several agent runtimes / undici defaults sit
// in the same range. A route that embeds its full route description + Bazaar
// input/output schema in the base64 header (help-me was ~5.4KB) risks 402 "touches"
// that some clients/proxies drop before the agent ever retries with payment.
//
// The header MUST carry { x402Version, error, resource, accepts } for the pay-path,
// and MAY additionally carry top-level { description, mimeType, extensions } so the
// Coinbase Python x402_action_provider (make_http_request) can populate discoveryInfo
// — it extracts those from the DECODED header object, not from resource{}. The header
// `extensions` MUST include extensions.bazaar (info + input/output schema): x402scan's
// v2 parser reads it from the header (2026-07 spec, docs/DISCOVERY.md in their repo) and
// marks routes non-invocable without it. The heavyweight extension block (batch
// settlement, auth-capture, eip2612, receipts) stays body-only. So this test
// asserts the header is under threshold AND its extensions stay small, while the rich
// discovery metadata is still preserved in the body so cataloging is intact.
//
// Run: node scripts/x402-header-size-selftest.mjs   (exit 1 on any failure)

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Conservative single-header ceiling. 8KB is the nginx large_client_header_buffers
// per-line default and a common proxy/runtime limit; we hold every route well under it.
const HEADER_MAX_BYTES = 8 * 1024;

// Base-only production-shaped env (X402_PAYTO set, no extra rails) — the real default.
const ENV = { X402_PAYTO: "0x000000000000000000000000000000000000dEaD" };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const X402_DIR = join(ROOT, "functions", "api", "bar", "x402");

// Every paid x402 route that emits a 402 PAYMENT-REQUIRED on a bare GET. We discover
// them from the directory so a newly added oversized route fails this gate too.
const SKIP = new Set(["[slug].js", "doctor.js", "index-check.js", "payment-confirmation-check.js"]);

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
const enc = (s) => new TextEncoder().encode(s).length;

function listRoutes() {
  return readdirSync(X402_DIR)
    .filter((f) => f.endsWith(".js") && !SKIP.has(f))
    .map((f) => ({ file: f, name: `/api/bar/x402/${f.replace(/\.js$/, "")}` }));
}

async function emit402(modFile, name) {
  const mod = await import(join(X402_DIR, modFile));
  if (typeof mod.onRequestGet !== "function") return null; // not a bare-GET paid route
  const request = new Request(`https://secondeyesai.com${name}`, { method: "GET" });
  const res = await mod.onRequestGet({ request, env: ENV, waitUntil() {}, passThroughOnException() {} });
  return res;
}

function decodeHeader(b64) {
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}

// Required for the pay-path.
const REQUIRED_KEYS = ["x402Version", "error", "resource", "accepts"];
// Optional discovery enrichment the Coinbase Python provider reads from the header.
const OPTIONAL_KEYS = ["description", "mimeType", "extensions"];
const ALLOWED_KEYS = [...REQUIRED_KEYS, ...OPTIONAL_KEYS];

// The header `extensions` must stay the compact listing-identity subset — never the
// full Bazaar input/output schema. Hold it well under 1KB so a route can't quietly
// reintroduce the multi-KB header bloat this gate exists to prevent.
const HEADER_EXTENSIONS_MAX_BYTES = 4096;

const report = [];

for (const { file, name } of listRoutes()) {
  let res;
  try {
    res = await emit402(file, name);
  } catch (e) {
    fail(name, `route threw on bare GET: ${e.message}`);
    continue;
  }
  if (!res) continue; // route has no GET 402 path (POST-only with body, etc.)

  if (res.status !== 402) {
    // Some routes only 402 with a different shape; skip non-402s cleanly.
    continue;
  }

  const header = res.headers.get("PAYMENT-REQUIRED");
  if (!header) {
    fail(name, "402 with no PAYMENT-REQUIRED header");
    continue;
  }

  const bytes = enc(header);
  let decoded;
  try {
    decoded = decodeHeader(header);
  } catch (e) {
    fail(name, `PAYMENT-REQUIRED is not valid base64 JSON: ${e.message}`);
    continue;
  }

  // (1) under the conservative single-header ceiling
  if (bytes > HEADER_MAX_BYTES) {
    fail(name, `PAYMENT-REQUIRED header is ${bytes}B (> ${HEADER_MAX_BYTES}B). Trim resource.description / keep Bazaar metadata in the 402 body, not the header.`);
  }

  // (2) shape: required pay-path keys present, only allowed keys, header extensions stay compact
  const missing = REQUIRED_KEYS.filter((k) => !(k in decoded));
  if (missing.length) {
    fail(name, `PAYMENT-REQUIRED header is missing required keys: ${missing.join(", ")}`);
  }
  const extraKeys = Object.keys(decoded).filter((k) => !ALLOWED_KEYS.includes(k));
  if (extraKeys.length) {
    fail(name, `PAYMENT-REQUIRED header has unexpected keys: ${extraKeys.join(", ")}`);
  }
  if ("extensions" in decoded) {
    const extBytes = enc(JSON.stringify(decoded.extensions));
    if (extBytes > HEADER_EXTENSIONS_MAX_BYTES) {
      fail(name, `header extensions is ${extBytes}B (> ${HEADER_EXTENSIONS_MAX_BYTES}B) — keep only the compact listing identity in the header; the full Bazaar schema belongs in the 402 body.`);
    }
    // The full Bazaar input/output schema must NOT ride the header.
    if (!decoded.extensions?.bazaar?.info || !decoded.extensions?.bazaar?.schema?.properties?.input) {
      fail(name, "header extensions MUST carry extensions.bazaar with info + schema.properties.input — x402scan's v2 parser reads the header and marks routes non-invocable without it (SCHEMA_INPUT_MISSING).");
    }
    if (decoded.extensions?.batch_settlement || decoded.extensions?.auth_capture || decoded.extensions?.eip2612_sponsorship || decoded.extensions?.offer_receipt) {
      fail(name, "heavyweight extension metadata (batch/auth-capture/eip2612/receipt) belongs in the 402 body, not the header.");
    }
  }
  if (!decoded.resource || typeof decoded.resource !== "object" || !decoded.resource.url) {
    fail(name, "header resource must be an object with a url");
  }
  if (!Array.isArray(decoded.accepts) || decoded.accepts.length === 0) {
    fail(name, "header accepts[] must be a non-empty array");
  }

  // (3) discovery preserved: the 402 BODY still carries the rich metadata the lean
  // header drops, so CDP cataloging (settle-driven, body/extension-fed) is unaffected.
  let body = null;
  try {
    body = await res.clone().json();
  } catch {
    body = null;
  }
  if (body) {
    const headerDesc = decoded.resource?.description || "";
    const bodyDesc = body.description || body.resource?.description || "";
    if (bodyDesc && bodyDesc.length < headerDesc.length) {
      fail(name, "402 body description is shorter than the header's — body must carry the FULL description for discovery.");
    }
    // If a route advertises a Bazaar block, it must ride the body (not the header).
    if (body.extensions?.bazaar && !body.extensions.bazaar.info) {
      fail(name, "402 body extensions.bazaar is present but missing .info — cataloging needs extensions.bazaar.info.");
    }
  }

  report.push({
    name,
    headerBytes: bytes,
    headerKeys: Object.keys(decoded).join(","),
    headerDescChars: (decoded.resource?.description || "").length,
    bodyDescChars: body ? (body.description || body.resource?.description || "").length : null,
    bodyHasBazaar: Boolean(body?.extensions?.bazaar?.info),
  });
}

if (report.length === 0) {
  fail("suite", "no paid x402 GET routes produced a 402 — discovery/loader is broken");
}

console.log(JSON.stringify({ HEADER_MAX_BYTES, routes: report }, null, 2));

if (failures.length) {
  console.error("\nx402 header-size self-test FAILED:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(
  `\nx402 header-size self-test OK — ${report.length} paid route(s); every PAYMENT-REQUIRED header carries the pay-path keys ({${REQUIRED_KEYS.join(",")}}) plus compact discovery (${OPTIONAL_KEYS.join(",")}), stays < ${HEADER_MAX_BYTES}B with extensions < ${HEADER_EXTENSIONS_MAX_BYTES}B; full description + Bazaar schema preserved in the 402 body.`
);
