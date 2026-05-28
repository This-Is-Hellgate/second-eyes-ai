import { apexRedirectResponse } from "./_lib/canonical-host.js";
import {
  enforceRateLimit,
  loadShedCheck,
  rateLimitResponse,
  trackInFlight,
} from "./_lib/resilience.js";

const INFLIGHT_HANDLERS = new Set(["/api/bar/proof", "/api/bar/enter", "/api/access/purchase", "/api/a4a"]);

export async function onRequest(context) {
  const redirect = apexRedirectResponse(context.request);
  if (redirect) return redirect;

  const url = new URL(context.request.url);
  if (!url.pathname.startsWith("/api/")) {
    return context.next();
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

  if (INFLIGHT_HANDLERS.has(url.pathname)) {
    return trackInFlight(() => context.next());
  }

  return context.next();
}
