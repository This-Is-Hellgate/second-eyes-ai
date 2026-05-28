import { accessJson, verifyAccessToken } from "../../_lib/access.js";
import { bearerToken, corsOptions } from "../../_lib/bar-pay.js";

export async function onRequestOptions() {
  return corsOptions("GET, OPTIONS");
}

export async function onRequestGet(context) {
  const claims = await verifyAccessToken(bearerToken(context.request), context.env);
  if (!claims) {
    return accessJson({ access: "none", error: "Missing or invalid Bearer token" }, 401, {
      "Access-Control-Allow-Origin": "*",
    });
  }

  return accessJson(
    {
      access: "active",
      scope: claims.scope || "bar_tab",
      plan: claims.plan,
      tool: claims.tool || null,
      tap: claims.tap || null,
      exp: claims.exp || null,
      rail: claims.rail || null,
    },
    200,
    { "Access-Control-Allow-Origin": "*" }
  );
}
