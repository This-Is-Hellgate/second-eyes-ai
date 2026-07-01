import { CANONICAL_HOST } from "./brand.js";

const WWW_HOST = "www.secondeyesai.com";

/** Permanent redirect www → apex; preserves path and query string. */
export function apexRedirectResponse(request) {
  const url = new URL(request.url);
  if (url.hostname !== WWW_HOST) return null;
  url.hostname = CANONICAL_HOST;
  return Response.redirect(url.toString(), 301);
}
