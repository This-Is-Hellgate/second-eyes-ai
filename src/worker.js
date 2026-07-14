/**
 * Second Eyes gatekeeper — Hono on Cloudflare Workers running the OFFICIAL
 * x402 SDK (@x402/hono + @x402/core + @x402/evm). Cloudflare verifies payment
 * at the edge; the handler serves the verdict/guidance; the middleware settles
 * ONLY after the handler succeeds — a buyer is never charged for a failed
 * check. Workers AI executes behind this gate when a door needs a model
 * (transcribe/extract); deterministic verdict doors run in pure worker logic.
 *
 * This is the "way" imported from Second Wind: the SDK is the gatekeeper, so
 * the hand-rolled payment/discovery code (and the CDP resource-indexing gap
 * x402#2821 flagged) is retired. Payment routes are generated from the live D1
 * curated index; only the EIP-712 domain (name/version) rides in `extra`.
 *
 * Pages "advanced mode": this file bundles to public/_worker.js (esbuild) and
 * takes over all routing; static assets pass through env.ASSETS. It is NOT
 * built/committed during the side-by-side phase — legacy functions/ still
 * serve until an explicit, proven cutover (see SPEC.md §2).
 */
import { Hono } from "hono";
import { paymentMiddlewareFromHTTPServer, x402HTTPResourceServer, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declarePaymentIdentifierExtension, PAYMENT_IDENTIFIER } from "@x402/extensions/payment-identifier";

import { SERVICE_NAME, TAGLINE, CANONICAL_ORIGIN } from "./lib/brand.js";
import { liveStubs, countLive, findItem, resolveCapability, getArtifact } from "./lib/curation.js";
import { recordSettledSale, recordDelivery, logRequest } from "./lib/ledger.js";
import { buildOpenApi, buildX402Resources, discoveryJson, toolBazaarExtension } from "./lib/discovery.js";
import { buildCdpAuthHeaders, facilitatorPaths } from "./lib/cdp-auth.js";
import { activeNetwork, activePayTo, activeFacilitatorUrl, isCdpFacilitator } from "./lib/networks.js";
import { invokeCheck } from "./lib/compute.js";

/* ------------------------------------------------------------------ *
 * Payment server — official SDK, constructed per curated-index snapshot
 * ------------------------------------------------------------------ */

function facilitatorClient(env) {
  const configured = activeFacilitatorUrl(env);
  let client;
  if (isCdpFacilitator(configured)) {
    const paths = facilitatorPaths(configured);
    client = new HTTPFacilitatorClient({
      url: `${paths.base}/platform/v2/x402`,
      createAuthHeaders: async () => ({
        verify: await buildCdpAuthHeaders(env, "POST", paths.verifyPath),
        settle: await buildCdpAuthHeaders(env, "POST", paths.settlePath),
        supported: await buildCdpAuthHeaders(env, "GET", "/platform/v2/x402/supported"),
      }),
    });
  } else {
    client = new HTTPFacilitatorClient({ url: configured.replace(/\/$/, "") });
  }
  // Offline test fixture: the selftest runs with no network and supplies the
  // facilitator /supported contract itself. Never set in production.
  if (env.X402_TEST_SUPPORTED_KINDS) {
    client.getSupported = async () => JSON.parse(env.X402_TEST_SUPPORTED_KINDS);
  }
  return client;
}

/** One RouteConfig per live door, from the curated index. */
function routeForStub(stub, payTo, network) {
  const url = `${CANONICAL_ORIGIN}/api/x402/${stub.slug || stub.sku}`;
  return {
    accepts: [
      {
        scheme: "exact",
        network,
        payTo,
        price: `$${Number(stub.price_usd).toFixed(stub.price_usd < 0.01 ? 3 : 2)}`,
      },
    ],
    description: `${stub.name} — ${String(stub.summary || "").slice(0, 140)}`,
    mimeType: "application/json",
    resource: url,
    serviceName: SERVICE_NAME,
    tags: [stub.item_type, "second-eyes", "x402"].filter(Boolean).slice(0, 5),
    iconUrl: `${CANONICAL_ORIGIN}/favicon.ico`,
    extensions: {
      ...toolBazaarExtension(stub),
      [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(false),
    },
  };
}

/** verdict/workersai doors sell POST (state in → verdict out); the rest GET. */
function methodForStub(stub) {
  return stub.invoke_kind === "verdict" || stub.invoke_kind === "workersai" ? "POST" : "GET";
}

/**
 * The payment middleware is rebuilt when the curated index changes; cached
 * per isolate for 60s so route lookups stay cheap without drifting from it.
 */
const paymentCache = { middleware: null, expires: 0 };

async function getPaymentMiddleware(env) {
  const now = Date.now();
  if (paymentCache.middleware && now < paymentCache.expires) return paymentCache.middleware;

  const payTo = activePayTo(env);
  if (!payTo) return null;

  const net = activeNetwork(env);
  const doors = await liveStubs(env);
  const routes = {};
  for (const stub of doors) {
    const route = routeForStub(stub, payTo, net.id);
    const method = methodForStub(stub);
    routes[`${method} /api/x402/${stub.slug || stub.sku}`] = route;
    if (stub.slug && stub.sku !== stub.slug) routes[`${method} /api/x402/${stub.sku}`] = route;
    if (stub.invoke_kind === "r2") {
      routes[`GET /api/x402/${stub.slug || stub.sku}/artifact`] = route;
      if (stub.slug && stub.sku !== stub.slug) routes[`GET /api/x402/${stub.sku}/artifact`] = route;
    }
  }
  if (Object.keys(routes).length === 0) {
    paymentCache.middleware = "empty";
    paymentCache.expires = now + 60_000;
    return "empty";
  }

  const resourceServer = new x402ResourceServer(facilitatorClient(env))
    .register(net.id, new ExactEvmScheme())
    // Ledger: the record of every settled sale stays in D1. Errors here must
    // never break delivery — the settlement already happened on-chain.
    .onAfterSettle(async (context) => {
      try {
        const paymentId = `pay_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
        const sku = skuFromResourceUrl(context.paymentPayload?.resource?.url) || "";
        await recordSettledSale(env, {
          id: paymentId,
          sku,
          price_usd: Number(context.requirements?.amount || 0) / 1_000_000,
          amount_usdc_micros: String(context.requirements?.amount || ""),
          payer: context.result?.payer || "",
          network: context.requirements?.network || "",
          scheme: context.requirements?.scheme || "exact",
          idempotency_key: `settle:${context.result?.transaction || crypto.randomUUID()}`,
          tx_hash: context.result?.transaction || "",
        });
        await recordDelivery(env, paymentId, sku, "");
      } catch (err) {
        console.log(JSON.stringify({ event: "ledger_write_failed", error: String(err?.message || err) }));
      }
    });

  const httpServer = new x402HTTPResourceServer(resourceServer, routes);
  paymentCache.middleware = paymentMiddlewareFromHTTPServer(httpServer);
  paymentCache.expires = now + 60_000;
  return paymentCache.middleware;
}

function skuFromResourceUrl(url) {
  if (!url) return null;
  const m = String(url).match(/\/api\/x402\/([^/?#]+)/);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */

const app = new Hono();

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*" };

// Request logging — fire-and-forget, must never break serving.
app.use("*", async (c, next) => {
  await next();
  if (c.req.method === "OPTIONS") return;
  const path = new URL(c.req.url).pathname;
  if (!path.startsWith("/api/")) return;
  const ua = (c.req.header("User-Agent") || "").toLowerCase();
  const uaClass = !ua
    ? "none"
    : /bot|crawl|spider|scan|probe|monitor/.test(ua)
      ? "crawler"
      : /python|node|curl|wget|go-http|axios|fetch/.test(ua)
        ? "agent"
        : "browser";
  c.executionCtx?.waitUntil?.(
    logRequest(c.env, {
      path,
      sku: path.startsWith("/api/x402/") ? path.split("/").pop() : "",
      method: c.req.method,
      status: c.res?.status ?? 0,
      uaClass,
    })
  );
});

// LEGACY COMPAT (cutover only): the live site's agents call /api/bar/*. When
// _worker.js becomes the entrypoint it owns ALL routing, so the full
// /api/bar/* → new-route map must land WITH the cutover (SPEC.md §2, step:
// legacy-compat). Until then this worker is not deployed and functions/ serves
// those paths unchanged. Entry alias shown as the canonical example:
app.all("/api/bar", (c) => c.redirect(`/api/checks${new URL(c.req.url).search}`, 302));

// CORS preflight for the paid surface.
app.options("/api/*", (c) =>
  c.body(null, 204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, PAYMENT-SIGNATURE, Idempotency-Key",
  })
);

// Free: liveness proof.
app.get("/api/proof", async (c) => {
  let liveCount = null;
  let inventoryOk = false;
  try {
    liveCount = await countLive(c.env);
    inventoryOk = Boolean(c.env.SE_DB);
  } catch {
    inventoryOk = false;
  }
  return c.json(
    {
      service: SERVICE_NAME,
      status: inventoryOk ? "live" : "degraded",
      checks_live: liveCount,
      payment: {
        rail: "x402",
        x402Version: 2,
        network: activeNetwork(c.env).id,
        asset: "USDC",
        payTo_configured: Boolean(c.env.X402_PAYTO_PUBLIC || c.env.X402_PAYTO),
        facilitator_configured: Boolean(c.env.X402_FACILITATOR_URL),
      },
      discovery: {
        checks: `${CANONICAL_ORIGIN}/api/checks`,
        openapi: `${CANONICAL_ORIGIN}/openapi.json`,
        x402_resources: `${CANONICAL_ORIGIN}/v2/x402/discovery/resources`,
        well_known: `${CANONICAL_ORIGIN}/.well-known/x402`,
      },
    },
    200,
    JSON_HEADERS
  );
});

// Free: the checks listing.
app.get("/api/checks", async (c) => {
  const doors = await liveStubs(c.env);
  return c.json(
    {
      service: SERVICE_NAME,
      tagline: TAGLINE,
      total_live: doors.length,
      payment: {
        rail: "x402",
        network: activeNetwork(c.env).id,
        asset: "USDC",
        how: "GET a guidance door (or POST your state to a check) -> 402 -> sign -> retry with PAYMENT-SIGNATURE",
      },
      checks: doors.map((t) => ({
        sku: t.sku,
        name: t.name,
        item_type: t.item_type,
        service: t.service_slug,
        category: t.category_slug,
        token_estimate: t.token_estimate,
        price_usd: t.price_usd,
        summary: t.summary,
        url: `${CANONICAL_ORIGIN}/api/x402/${t.slug || t.sku}`,
      })),
    },
    200,
    { ...JSON_HEADERS, "Cache-Control": "public, max-age=300" }
  );
});

// Free: generated discovery documents (one source: the curated index).
app.get("/openapi.json", async (c) => discoveryJson(await buildOpenApi(c.env, new URL(c.req.url).origin)));
app.get("/v2/x402/discovery/resources", async (c) => discoveryJson(await buildX402Resources(c.env, new URL(c.req.url).origin)));
app.get("/.well-known/x402", async (c) => discoveryJson(await buildX402Resources(c.env, new URL(c.req.url).origin)));

// Paid surface — the OFFICIAL SDK middleware verifies before the handler and
// settles after it succeeds. A buyer is never charged for a failed response.
app.use("/api/x402/*", async (c, next) => {
  const middleware = await getPaymentMiddleware(c.env);
  if (!middleware) return c.json({ error: "payment_rail_not_configured" }, 503, JSON_HEADERS);
  if (middleware === "empty") return next(); // no live doors: handler 404s below
  return middleware(c, next);
});

// Paid check — verdict/workersai doors. Verified by the middleware above; a
// failed run returns >= 400, so the SDK cancels settlement (never charged).
app.post("/api/x402/:key", async (c) => {
  const item = await findItem(c.env, c.req.param("key"));
  if (!item) {
    return c.json({ error: "unknown_sku", checks: "/api/checks" }, 404, JSON_HEADERS);
  }
  if (item.invoke_kind !== "verdict" && item.invoke_kind !== "workersai") {
    return c.json({ error: "method_not_allowed", hint: `This door resolves: GET /api/x402/${item.slug || item.sku}` }, 405, JSON_HEADERS);
  }
  let body = {};
  try {
    body = await c.req.json();
  } catch {
    body = {}; // state-optional checks may run on an empty body
  }
  const run = await invokeCheck(c.env, item, body);
  if (!run.ok) {
    return c.json({ error: run.error, sku: item.sku }, run.status || 502, JSON_HEADERS);
  }
  return c.json(run.result, 200, JSON_HEADERS);
});

// Deliberate, secondary artifact fetch — reached through the resolved
// capability, same x402 gate. Never the front door.
app.get("/api/x402/:key/artifact", async (c) => {
  const item = await findItem(c.env, c.req.param("key"));
  if (!item || item.invoke_kind !== "r2") {
    return c.json({ error: "unknown_artifact", checks: "/api/checks" }, 404, JSON_HEADERS);
  }
  const object = await getArtifact(c.env, item);
  if (!object) {
    // Missing artifact — never charge for it: a 5xx makes the SDK cancel
    // settlement (verified, not settled).
    return c.json({ error: "artifact_missing", sku: item.sku }, 503, JSON_HEADERS);
  }
  return c.body(object.body, 200, {
    ...JSON_HEADERS,
    "Content-Type": item.mime_type || object.httpMetadata?.contentType || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${item.slug || item.sku}"`,
    "X-Content-Hash": item.content_hash || "",
  });
});

// The paid deliverable for guidance doors: the RESOLVED CAPABILITY — guidance
// (the voice), composition (the wired graph neighborhood), invocation.
app.get("/api/x402/:key", async (c) => {
  const item = await findItem(c.env, c.req.param("key"));
  if (!item) {
    return c.json({ error: "unknown_sku", checks: "/api/checks" }, 404, JSON_HEADERS);
  }
  if (item.invoke_kind === "verdict" || item.invoke_kind === "workersai") {
    return c.json({ error: "method_not_allowed", hint: `This door is a check: POST /api/x402/${item.slug || item.sku} with a JSON body { "state": "..." }` }, 405, JSON_HEADERS);
  }
  const resolved = await resolveCapability(c.env, item, new URL(c.req.url).origin);
  return c.json(resolved, 200, JSON_HEADERS);
});

// Teaching 405/404 for wrong methods on known surfaces.
app.all("/api/*", (c) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") {
    return c.json({ error: "unknown_path", checks: "/api/checks", openapi: "/openapi.json" }, 404, JSON_HEADERS);
  }
  return c.json(
    {
      error: "method_not_allowed",
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      hint: "Guidance doors are GET; checks are POST. The exact method per path is declared in openapi.json.",
      docs: { openapi: `${new URL(c.req.url).origin}/openapi.json`, checks: `${new URL(c.req.url).origin}/api/checks` },
    },
    405,
    JSON_HEADERS
  );
});

// Everything else: static assets (llms.txt, agent card, favicons).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  // HEAD mirrors GET everywhere (headers only) — agents probe with HEAD.
  async fetch(request, env, ctx) {
    if (request.method === "HEAD") {
      const asGet = new Request(request.url, { method: "GET", headers: request.headers });
      const res = await app.fetch(asGet, env, ctx);
      return new Response(null, { status: res.status, headers: res.headers });
    }
    return app.fetch(request, env, ctx);
  },
};

export { app };
