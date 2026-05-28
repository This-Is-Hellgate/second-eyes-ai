import { accessJson, getPlan, issueAccessToken } from "../../_lib/access.js";
import { recordAccessGrant, findAccessGrantByStripeSession } from "../../_lib/a4a-store.js";
import { issueBarTabToken } from "../../_lib/bar-pay.js";

export async function onRequestPost(context) {
  const secret = context.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return accessJson({ error: "STRIPE_WEBHOOK_SECRET not configured" }, 503);
  }

  const signature = context.request.headers.get("Stripe-Signature");
  if (!signature) {
    return accessJson({ error: "Missing Stripe-Signature" }, 400);
  }

  const payload = await context.request.text();
  const valid = await verifyStripeSignature(payload, signature, secret);
  if (!valid) {
    return accessJson({ error: "Invalid signature" }, 400);
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return accessJson({ error: "Invalid JSON" }, 400);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const planId =
      session.metadata?.plan ||
      inferPlanFromAmount(session.amount_total) ||
      "lifetime";

    const plan = getPlan(planId);
    if (!plan) {
      return accessJson({ error: "Unknown plan in session metadata" }, 400);
    }

    const existing = await findAccessGrantByStripeSession(context.env, session.id);
    if (existing) {
      return accessJson({ ok: true, plan: plan.id, idempotent: true, grantId: existing.id });
    }

    const grantId = await recordAccessGrant(context.env, {
      planId: plan.id,
      rail: "stripe",
      payerRef: session.customer_details?.email || session.customer_email || null,
      txRef: session.payment_intent || session.id,
      stripeSessionId: session.id,
      expiresAt: plan.durationDays
        ? new Date(Date.now() + plan.durationDays * 86400000).toISOString()
        : null,
    });

    await issueBarTabToken(plan, context.env, grantId);

    return accessJson({ ok: true, plan: plan.id, tokenIssued: true, grantId });
  }

  return accessJson({ ok: true, ignored: event.type });
}

function inferPlanFromAmount(amountTotalCents) {
  if (amountTotalCents === 1000) return "monthly";
  if (amountTotalCents === 10000) return "annual";
  if (amountTotalCents === 25000) return "lifetime";
  return null;
}

async function verifyStripeSignature(payload, header, secret) {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k, v];
    })
  );
  const timestamp = parts.t;
  const sig = parts.v1;
  if (!timestamp || !sig) return false;

  const signed = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed));
  const expectedHex = [...new Uint8Array(expected)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(expectedHex, sig);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
