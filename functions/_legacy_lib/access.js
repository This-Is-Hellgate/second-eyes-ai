/** One access product — billing schedule only differs. */
export const ACCESS_PLANS = {
  monthly: {
    id: "monthly",
    label: "Monthly",
    priceUsd: 10,
    durationDays: 30,
    stripeEnv: "STRIPE_LINK_MONTHLY",
  },
  annual: {
    id: "annual",
    label: "Annual",
    priceUsd: 100,
    durationDays: 365,
    stripeEnv: "STRIPE_LINK_ANNUAL",
  },
  lifetime: {
    id: "lifetime",
    label: "Lifetime",
    priceUsd: 250,
    durationDays: null,
    stripeEnv: "STRIPE_LINK_LIFETIME",
  },
};

export function getPlan(planId) {
  return ACCESS_PLANS[planId] || null;
}

/**
 * Plans an AGENT may discover and buy over x402 / A4A. The lounge is agent-only
 * and per-use micropayments are the native model; the only standing tab offered
 * to agents is `annual`. `monthly` and `lifetime` are human checkout artifacts —
 * they remain in ACCESS_PLANS so the Stripe webhook can still resolve existing
 * human purchases, but they are never advertised or sold through agent rails.
 */
export const AGENT_PLAN_IDS = ["annual"];

export function getAgentPlan(planId) {
  return AGENT_PLAN_IDS.includes(planId) ? ACCESS_PLANS[planId] || null : null;
}

export function planFromStripeLink(env, url) {
  if (!url) return null;
  for (const plan of Object.values(ACCESS_PLANS)) {
    const link = env[plan.stripeEnv];
    if (link && link === url) return plan;
  }
  return null;
}

export async function issueAccessToken(plan, env, extra = {}) {
  const secret = env.ACCESS_TOKEN_SECRET;
  if (!secret) throw new Error("ACCESS_TOKEN_SECRET not configured");

  const planId = typeof plan === "string" ? plan : plan.id;
  const known = getPlan(planId);
  const durationDays =
    typeof plan === "object" && plan.durationDays !== undefined
      ? plan.durationDays
      : known?.durationDays;

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: "secondeye-access",
    plan: planId,
    iat: now,
    ...(durationDays ? { exp: now + durationDays * 86400 } : {}),
    ...extra,
  };

  return signJwt(payload, secret);
}

export async function verifyAccessToken(token, env) {
  const secret = env.ACCESS_TOKEN_SECRET;
  if (!secret || !token) return null;
  return verifyJwt(token, secret);
}

function b64url(input) {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

async function verifyJwt(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const key = await importHmacKey(secret);
  const expected = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );
  const expectedB64 = b64url(new Uint8Array(expected));
  if (sig !== expectedB64) return null;

  let payload;
  try {
    payload = JSON.parse(decodeB64url(body));
  } catch {
    return null;
  }

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (payload.sub !== "secondeye-access") return null;
  return payload;
}

function decodeB64url(part) {
  const pad = "=".repeat((4 - (part.length % 4)) % 4);
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return atob(b64);
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export function accessJson(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

/**
 * Canonical error response. Stable machine `code`, human `message`, and a
 * `requestId` that callers can quote and we can grep server-side.
 *
 * Transitional shape: `error` keeps the human string for back-compat with
 * existing consumers (incl. the MCP package) while `code` is the new stable
 * field machine callers should branch on. `extra` merges top-level fields a
 * given endpoint must preserve (e.g. status.js `access: "none"`).
 */
export function errorJson(code, message, { status = 400, details, requestId, headers = {}, extra = {} } = {}) {
  const rid = requestId || `req_${crypto.randomUUID()}`;
  return accessJson(
    {
      ...extra,
      error: message,
      code,
      message,
      requestId: rid,
      ...(details ? { details } : {}),
    },
    status,
    headers
  );
}
