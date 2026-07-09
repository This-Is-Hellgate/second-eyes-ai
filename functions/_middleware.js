import { apexRedirectResponse } from "./_lib/canonical-host.js";
import { logBarRequest } from "./_lib/bar-request-log.js";
import { buildX402Resources, discoveryJson } from "./_lib/discovery.js";
import {
  enforceRateLimit,
  loadShedCheck,
  rateLimitResponse,
  trackInFlight,
} from "./_lib/resilience.js";

const INFLIGHT_HANDLERS = new Set(["/api/bar/proof", "/api/bar/enter", "/api/access/purchase", "/api/a4a"]);

/**
 * Teaching 405 — a wrong method must never be a dead end for an agent.
 * Cloudflare's default 405 is a bare text body with no guidance; agents that
 * guessed POST on a GET surface (or vice versa) simply left. This replaces the
 * body with machine-readable directions. No Allow header: methods vary per
 * path and a wrong Allow is worse than none — openapi.json carries the exact
 * method for every path.
 */
function methodNotAllowedResponse(url, method) {
  return new Response(
    JSON.stringify(
      {
        error: "method_not_allowed",
        method,
        path: url.pathname,
        hint:
          "Paid doors under /api/bar/x402/ accept GET; doors with inputs (help-me, schema-repair, context-pressure, payment-confirmation-check, transcribe, extract, doctor, index-check) also accept POST with a JSON body. Discovery and proof surfaces are GET. Session actions (leave, pause, marks/discover, a4a) are POST. The exact method per path is declared in openapi.json.",
        docs: {
          openapi: `${url.origin}/openapi.json`,
          agent_instructions: `${url.origin}/llms.txt`,
          catalog: `${url.origin}/api/bar/catalog`,
        },
      },
      null,
      2
    ),
    {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

export async function onRequest(context) {
  const redirect = apexRedirectResponse(context.request);
  if (redirect) return redirect;

  const url = new URL(context.request.url);

  // /.well-known/x402 — the emerging standard x402 discovery location
  // (IETF draft; x402scan fallback). Served from the same builder as
  // /v1|/v2/x402/discovery/resources so the three surfaces cannot drift.
  if (url.pathname === "/.well-known/x402" && (context.request.method === "GET" || context.request.method === "HEAD")) {
    const doc = discoveryJson(buildX402Resources(`${url.protocol}//${url.host}`, context.env, { discoveryVersion: 2 }));
    if (context.request.method === "HEAD") {
      return new Response(null, { status: doc.status, headers: doc.headers });
    }
    return doc;
  }

  // HEAD must behave as GET-without-body everywhere. Pages binds the route
  // method BEFORE middleware, so context.next() with a swapped method cannot
  // re-dispatch to a function route (only to static assets). Static paths:
  // convert via next(). Function paths (/api/): make an internal same-zone
  // GET fetch and strip the body. The internal request is a GET, so it can
  // never re-enter this branch — loop-safe.
  const isHead = context.request.method === "HEAD";
  const runNext = () =>
    isHead
      ? context.next(new Request(context.request.url, { method: "GET", headers: context.request.headers }))
      : context.next();
  const runNextApi = () =>
    isHead
      ? fetch(new Request(context.request.url, { method: "GET", headers: context.request.headers }))
      : context.next();

  if (!url.pathname.startsWith("/api/")) {
    const response = await runNext();
    if (isHead) return new Response(null, { status: response.status, headers: response.headers });
    if (response.status === 405) return methodNotAllowedResponse(url, context.request.method);
    return response;
  }

  if (url.pathname.startsWith("/api/bar") && context.request.method !== "OPTIONS") {
    const logPromise = logBarRequest(context.env, context.request, url.pathname);
    if (typeof context.waitUntil === "function") {
      context.waitUntil(logPromise);
    } else {
      await logPromise;
    }
  }

  if (context.request.method === "OPTIONS") {
    return context.next();
  }

  const shed = loadShedCheck(context.request, url.pathname);
  if (!shed.ok) {
    return rateLimitResponse(shed);
  }

  const limit = enforceRateLimit(context.request, url.pathname);
  if (!limit.ok) {
    return rateLimitResponse(limit);
  }

  const response = INFLIGHT_HANDLERS.has(url.pathname) ? await trackInFlight(runNextApi) : await runNextApi();

  if (isHead) {
    return new Response(null, { status: response.status, headers: response.headers });
  }
  if (response.status === 405) {
    return methodNotAllowedResponse(url, context.request.method);
  }
  return response;
}
