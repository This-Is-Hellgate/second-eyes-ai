import { getAgentPlan } from "./access.js";
import { MICRO_TAP, TOOL_PURCHASE } from "./bar-catalog.js";
import { makeId } from "./review.js";

export function resolveBarProduct(params) {
  const product = params.get("product");

  if (product === "micro") {
    const tap = params.get("tap");
    if (!tap) return { error: "Missing tap slug for product=micro" };
    return {
      kind: "micro",
      id: `micro:${tap}`,
      priceUsd: MICRO_TAP.priceUsd,
      label: `Micro tap (${tap})`,
      tap,
      singleUse: true,
      ttlSeconds: MICRO_TAP.ttlSeconds,
    };
  }

  if (product === "tool") {
    const tool = params.get("tool");
    if (!tool) return { error: "Missing tool id for product=tool" };
    return {
      kind: "tool",
      id: `tool:${tool}`,
      priceUsd: TOOL_PURCHASE.priceUsd,
      label: `Tool purchase (${tool})`,
      tool,
      singleUse: false,
    };
  }

  const planId = params.get("plan") || "annual";
  const plan = getAgentPlan(planId);
  if (!plan) return { error: "Unknown plan. Use annual." };
  return {
    kind: "bar_tab",
    id: plan.id,
    priceUsd: plan.priceUsd,
    label: plan.label,
    plan,
    singleUse: false,
    ttlSeconds: plan.durationDays ? plan.durationDays * 86400 : null,
  };
}

export async function issueProductToken(product, env, extra = {}) {
  const secret = env.ACCESS_TOKEN_SECRET;
  if (!secret) throw new Error("ACCESS_TOKEN_SECRET not configured");

  const now = Math.floor(Date.now() / 1000);
  const jti = makeId("jti");

  const payload = {
    sub: "secondeye-access",
    scope: product.kind,
    jti,
    iat: now,
    ...extra,
  };

  if (product.kind === "micro") {
    payload.tap = product.tap;
    payload.exp = now + product.ttlSeconds;
    payload.single_use = true;
  } else if (product.kind === "tool") {
    payload.tool = product.tool;
  } else if (product.kind === "bar_tab") {
    payload.plan = product.plan.id;
    if (product.plan.durationDays) {
      payload.exp = now + product.plan.durationDays * 86400;
    }
  }

  return { token: await signJwt(payload, secret), jti, payload };
}

export async function authorizeTapAccess(claims, tapSlug, env) {
  if (!claims) return { ok: false, reason: "missing_token" };

  if (claims.scope === "bar_tab") {
    return { ok: true, via: "bar_tab", plan: claims.plan };
  }

  if (claims.scope === "tool") {
    const tap = (await import("./bar-catalog.js")).getTap(tapSlug);
    if (tap && tap.tool === claims.tool) {
      return { ok: true, via: "tool", tool: claims.tool };
    }
    return { ok: false, reason: "tool_mismatch" };
  }

  if (claims.scope === "micro") {
    if (claims.tap !== tapSlug) {
      return { ok: false, reason: "tap_mismatch" };
    }
    if (claims.jti && env.DB) {
      const used = await env.DB.prepare(
        "SELECT id FROM access_redemptions WHERE jti = ? AND resource = ?"
      )
        .bind(claims.jti, `tap:${tapSlug}`)
        .first();
      if (used) return { ok: false, reason: "micro_already_used" };
    }
    return { ok: true, via: "micro", tap: tapSlug, jti: claims.jti, singleUse: true };
  }

  return { ok: false, reason: "invalid_scope" };
}

export async function markMicroRedemption(env, jti, tapSlug, grantId) {
  if (!env.DB || !jti) return;
  const { nowIso } = await import("./review.js");
  await env.DB.prepare(
    `INSERT OR IGNORE INTO access_redemptions (id, jti, resource, grant_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(makeId("red"), jti, `tap:${tapSlug}`, grantId || null, nowIso())
    .run();
}

export { verifyAccessToken } from "./access.js";

async function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

function b64url(input) {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}
