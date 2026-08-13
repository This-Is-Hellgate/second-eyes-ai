#!/usr/bin/env node
/**
 * Self-test for machine-readable discovery compatibility surfaces.
 *
 * Usage: node scripts/discovery-compat-selftest.mjs
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

{
  const spec = buildOpenApi(ORIGIN, {});
  eq(spec.openapi, "3.1.0", "openapi version is 3.1.0");
  ok(spec.info && typeof spec.info.title === "string", "openapi info.title present");
  eq(spec.info["x-audience"], "autonomous_agents", "openapi audience is agents");
  ok(Array.isArray(spec.servers) && spec.servers[0].url === ORIGIN, "openapi server uses origin");
  ok(spec.paths && typeof spec.paths === "object", "openapi paths object present");

  const coreDoors = [
    "/api/bar/x402/help-me",
    "/api/bar/x402/schema-repair",
    "/api/bar/x402/context-pressure",
    "/api/bar/x402/payment-confirmation-check",
    "/api/bar/x402/analyze-video-audio-and-pdfs",
    "/api/bar/x402/turn-paper-into-code",
    "/api/bar/x402/doctor",
    "/api/bar/x402/index-check",
  ];
  for (const p of coreDoors) {
    ok(spec.paths[p] && spec.paths[p].get, `openapi describes GET ${p}`);
    ok(spec.paths[p]?.get?.responses?.["402"], `openapi ${p} documents a 402`);
  }

  ok(!spec.paths["/api/bar/x402/transcribe"], "legacy transcribe slug is not advertised");
  ok(!spec.paths["/api/bar/x402/extract"], "legacy extract slug is not advertised");
  ok(/video|audio|pdf/i.test(spec.paths["/api/bar/x402/analyze-video-audio-and-pdfs"]?.get?.summary || ""), "Content Analysis summary names inaccessible modalities");
  ok(/paper/i.test(spec.paths["/api/bar/x402/turn-paper-into-code"]?.get?.summary || ""), "Paper-to-Code summary names paper input");
  ok(/code|implementation|repository/i.test(spec.paths["/api/bar/x402/turn-paper-into-code"]?.get?.summary || ""), "Paper-to-Code summary sells implementation outcome");

  for (const p of ["/api/bar/proof", "/api/bar/stats", "/api/bar/proof/payments", "/.well-known/mcp.json"]) {
    ok(spec.paths[p] && spec.paths[p].get, `openapi describes free surface ${p}`);
  }

  const pay = spec["x-payment"];
  ok(Array.isArray(pay.active_networks) && pay.active_networks.includes("eip155:8453"), "openapi active rail is Base");
  ok(!pay.active_networks.includes("eip155:137"), "openapi does NOT advertise Polygon as active");
  ok(pay.planned_networks.includes("eip155:137"), "openapi lists Polygon as planned");
  eq(pay.x402Version, 2, "openapi x402 version is 2");

  const dev = buildOpenApi("https://preview.example.dev", {});
  eq(dev.servers[0].url, "https://preview.example.dev", "openapi server reflects dev origin");
  ok(JSON.stringify(dev.paths).indexOf("secondeyesai.com") === -1, "openapi paths carry no absolute host");
}

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
  ok(!res.resources.some((r) => r.resource.endsWith("/transcribe")), `v${version} hides legacy transcribe slug`);
  ok(!res.resources.some((r) => r.resource.endsWith("/extract")), `v${version} hides legacy extract slug`);
  ok(res.resources.some((r) => r.resource.endsWith("/analyze-video-audio-and-pdfs")), `v${version} advertises Content Analysis`);
  ok(res.resources.some((r) => r.resource.endsWith("/turn-paper-into-code")), `v${version} advertises Paper-to-Code`);

  eq(res.links.openapi, `${ORIGIN}/openapi.json`, `v${version} links to openapi`);
  eq(res.links.help_me, `${ORIGIN}/api/bar/x402/help-me`, `v${version} links to help-me`);
  eq(res.links.mcp_manifest, `${ORIGIN}/.well-known/mcp.json`, `v${version} links to mcp manifest`);
  eq(res.links.proof_ledger, `${ORIGIN}/api/bar/proof/payments`, `v${version} links to proof ledger`);
}

{
  const p = buildApiDocsPointer(ORIGIN);
  eq(p.openapi, `${ORIGIN}/openapi.json`, "api-docs points at openapi");
  eq(p.openapi_v0, `${ORIGIN}/v0/openapi.json`, "api-docs points at openapi v0");
  ok(Array.isArray(p.x402_discovery) && p.x402_discovery.length === 2, "api-docs lists both x402 discovery paths");
  ok(/agent-only/i.test(p.note), "api-docs note states agent-only / no interactive console");
}

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
