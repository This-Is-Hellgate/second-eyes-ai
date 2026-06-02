#!/usr/bin/env node
/**
 * Self-test for the machine-readable discovery compatibility surfaces
 * (functions/_lib/discovery.js): /openapi.json, /v0/openapi.json,
 * /v1|/v2/x402/discovery/resources, /api-docs.
 *
 * These exist because agents were probing those paths and hitting 404s. The
 * test asserts the payloads are valid, origin-aware, agent-only, advertise Base
 * as the only settleable rail, and point back at the canonical paid doors — no
 * network, no secrets, no D1, pure functions.
 *
 * Usage: node scripts/discovery-compat-selftest.mjs    (exit 1 on any failure)
 */

import {
  buildOpenApi,
  buildX402Resources,
  buildApiDocsPointer,
} from "../functions/_lib/discovery.js";

const failures = [];
const ok = (cond, msg) => (cond ? null : failures.push(msg));
const eq = (got, want, msg) =>
  ok(got === want, `${msg} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const ORIGIN = "https://secondeyesai.com";

/* ---------- OpenAPI ---------- */
{
  const spec = buildOpenApi(ORIGIN, {});
  eq(spec.openapi, "3.1.0", "openapi version is 3.1.0");
  ok(spec.info && typeof spec.info.title === "string", "openapi info.title present");
  eq(spec.info["x-audience"], "autonomous_agents", "openapi audience is agents");
  ok(Array.isArray(spec.servers) && spec.servers[0].url === ORIGIN, "openapi server uses origin");
  ok(spec.paths && typeof spec.paths === "object", "openapi paths object present");

  // Core paid doors must all be described.
  const coreDoors = [
    "/api/bar/x402/help-me",
    "/api/bar/x402/schema-repair",
    "/api/bar/x402/context-pressure",
    "/api/bar/x402/payment-confirmation-check",
    "/api/bar/x402/transcribe",
    "/api/bar/x402/extract",
    "/api/bar/x402/doctor",
    "/api/bar/x402/index-check",
  ];
  for (const p of coreDoors) {
    ok(spec.paths[p] && spec.paths[p].get, `openapi describes GET ${p}`);
    ok(spec.paths[p].get.responses["402"], `openapi ${p} documents a 402`);
  }

  // Free proof/discovery surfaces are present.
  for (const p of ["/api/bar/proof", "/api/bar/stats", "/api/bar/proof/payments", "/.well-known/mcp.json"]) {
    ok(spec.paths[p] && spec.paths[p].get, `openapi describes free surface ${p}`);
  }

  // Base only; planned rails surfaced, never advertised as active.
  const pay = spec["x-payment"];
  ok(Array.isArray(pay.active_networks) && pay.active_networks.includes("eip155:8453"), "openapi active rail is Base");
  ok(!pay.active_networks.includes("eip155:137"), "openapi does NOT advertise Polygon as active");
  ok(pay.planned_networks.includes("eip155:137"), "openapi lists Polygon as planned");
  eq(pay.x402Version, 2, "openapi x402 version is 2");

  // Origin propagation: no hard-coded canonical host leaking when a dev origin is used.
  const dev = buildOpenApi("https://preview.example.dev", {});
  eq(dev.servers[0].url, "https://preview.example.dev", "openapi server reflects dev origin");
  ok(
    JSON.stringify(dev.paths).indexOf("secondeyesai.com") === -1,
    "openapi paths carry no absolute host (relative paths)"
  );
}

/* ---------- x402 discovery resources ---------- */
for (const version of [1, 2]) {
  const res = buildX402Resources(ORIGIN, {}, { discoveryVersion: version });
  ok(typeof res.schema_version === "string", `v${version} carries schema_version`);
  eq(res.x402Version, 2, `v${version} x402Version is 2`);
  eq(res.discovery_version, version, `v${version} echoes discovery_version`);
  ok(Array.isArray(res.resources) && res.resources.length >= 8, `v${version} lists the paid doors`);
  ok(res.network_active.includes("eip155:8453"), `v${version} active rail is Base`);
  ok(!res.network_active.includes("eip155:137"), `v${version} does NOT mark Polygon active`);
  ok(res.network_planned.includes("eip155:137"), `v${version} lists Polygon planned`);

  for (const r of res.resources) {
    ok(r.resource.startsWith(`${ORIGIN}/api/bar/x402/`), `v${version} resource is an absolute paid-door URL`);
    ok(r.x402 === true, `v${version} resource flagged x402`);
    eq(r.network, "eip155:8453", `v${version} resource network is Base`);
    ok(typeof r.price_usd === "number", `v${version} resource has numeric price`);
  }

  // Canonical links back to the real surfaces.
  eq(res.links.openapi, `${ORIGIN}/openapi.json`, `v${version} links to openapi`);
  eq(res.links.help_me, `${ORIGIN}/api/bar/x402/help-me`, `v${version} links to help-me`);
  eq(res.links.mcp_manifest, `${ORIGIN}/.well-known/mcp.json`, `v${version} links to mcp manifest`);
  eq(res.links.proof_ledger, `${ORIGIN}/api/bar/proof/payments`, `v${version} links to proof ledger`);
}

/* ---------- api-docs pointer ---------- */
{
  const p = buildApiDocsPointer(ORIGIN);
  eq(p.openapi, `${ORIGIN}/openapi.json`, "api-docs points at openapi");
  eq(p.openapi_v0, `${ORIGIN}/v0/openapi.json`, "api-docs points at openapi v0");
  ok(Array.isArray(p.x402_discovery) && p.x402_discovery.length === 2, "api-docs lists both x402 discovery paths");
  ok(/agent-only/i.test(p.note), "api-docs note states agent-only / no interactive console");
}

/* ---------- no trailing-slash doubling ---------- */
{
  const spec = buildOpenApi("https://secondeyesai.com/", {});
  eq(spec.servers[0].url, "https://secondeyesai.com", "trailing slash trimmed from server url");
  const res = buildX402Resources("https://secondeyesai.com/", {}, {});
  ok(res.links.openapi === "https://secondeyesai.com/openapi.json", "trailing slash trimmed in links");
}

if (failures.length) {
  console.error(`discovery-compat-selftest FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("discovery-compat-selftest OK");
