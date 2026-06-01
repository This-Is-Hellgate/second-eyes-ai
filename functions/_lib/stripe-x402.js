/**
 * Stripe machine-payments (x402) facilitator — ISOLATED, opt-in second rail.
 *
 * Port of https://docs.stripe.com/payments/machine/x402 to Cloudflare Pages
 * Functions (the doc sample is Node + @x402/hono + NodeCache; none of that runs
 * on Workers, so this calls Stripe's REST API via fetch and caches the minted
 * deposit address in D1 instead of in-process memory).
 *
 * HOW IT DIFFERS FROM THE CDP RAIL (functions/_lib/x402.js):
 *   - CDP rail: payTo is your single wallet (X402_PAYTO). Settlements compound
 *     CDP Bazaar merchant reputation. This is the default and is never touched.
 *   - Stripe rail: payTo is a FRESH Stripe-minted crypto deposit address per
 *     PaymentIntent. The agent's USDC lands at that address; Stripe captures it
 *     into your Stripe (fiat) balance. These settlements do NOT accrue to your
 *     wallet's Bazaar rank — that is the deliberate trade for fiat settlement.
 *
 * The clever part: once the deposit address is the payTo, the agent's payment is
 * a normal x402 exact-EVM transfer, so we reuse the EXISTING CDP verify+settle to
 * land the funds; Stripe then captures. The only Stripe-specific work here is
 * minting + caching the deposit address and validating the buyer paid to one we
 * issued (mirrors the doc's paymentCache guard).
 *
 * Inert unless STRIPE_SECRET_KEY is set — the CDP rail is unaffected either way.
 */
import {
  buildProductPaymentRequirements,
  payment402BodyForProduct,
  payment402Headers,
  readPaymentHeader,
  parsePaymentPayloadFromHeader,
  verifyAndSettlePayment,
  encodePaymentResponse,
} from "./x402.js";
import { accessJson } from "./access.js";
import { recordAccessGrant, findAccessGrantByTxRef } from "./a4a-store.js";
import { CACHE, paymentDegradedBody } from "./resilience.js";

/** Preview API version the crypto deposit PaymentIntent requires (per the doc). */
const STRIPE_API_VERSION = "2026-03-04.preview";
const STRIPE_API = "https://api.stripe.com/v1";
const CORS = { "Access-Control-Allow-Origin": "*" };

export function stripeX402Enabled(env) {
  return Boolean(env && env.STRIPE_SECRET_KEY);
}

/** Stripe wants nested form-encoding (payment_method_options[crypto][mode]=deposit). */
function formEncode(pairs) {
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

/**
 * Create a crypto PaymentIntent in deposit mode on Base and return its fresh
 * USDC deposit address. Mirrors createPayToAddress() in the Stripe doc.
 */
export async function createCryptoDepositAddress(env, amountUsd) {
  const cents = Math.max(1, Math.round(Number(amountUsd) * 100));
  const body = formEncode([
    ["amount", String(cents)],
    ["currency", "usd"],
    ["payment_method_types[]", "crypto"],
    ["payment_method_data[type]", "crypto"],
    ["payment_method_options[crypto][mode]", "deposit"],
    ["payment_method_options[crypto][deposit_options][networks][]", "base"],
    ["confirm", "true"],
  ]);

  let res;
  try {
    res = await fetch(`${STRIPE_API}/payment_intents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Stripe-Version": STRIPE_API_VERSION,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } catch (err) {
    return { ok: false, error: "stripe_unreachable", detail: String(err?.message || err).slice(0, 200) };
  }

  const pi = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: pi?.error?.code || "stripe_payment_intent_failed",
      message: pi?.error?.message || `Stripe returned HTTP ${res.status}`,
      status: res.status,
    };
  }

  const deposit = pi?.next_action?.crypto_display_details?.deposit_addresses?.base;
  const address = deposit?.address;
  if (!address) {
    return { ok: false, error: "no_deposit_address", message: "PaymentIntent did not return a Base deposit address." };
  }

  return {
    ok: true,
    address,
    paymentIntentId: pi.id,
    supportedTokens: deposit.supported_tokens || null,
  };
}

/** Persist a minted address so we can later confirm the buyer paid to one WE issued. */
export async function cacheDepositAddress(env, { address, paymentIntentId, slug, amountUsd }) {
  if (!env.DB) return;
  await env.DB.prepare(
    `INSERT INTO stripe_deposit_addrs (address, payment_intent_id, slug, amount_usd, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET payment_intent_id = excluded.payment_intent_id`
  )
    .bind(address.toLowerCase(), paymentIntentId, slug, Number(amountUsd), new Date().toISOString())
    .run();
}

export async function lookupDepositAddress(env, address) {
  if (!env.DB || !address) return null;
  return env.DB.prepare(
    `SELECT address, payment_intent_id, slug, amount_usd, created_at FROM stripe_deposit_addrs WHERE address = ?`
  )
    .bind(String(address).toLowerCase())
    .first();
}

/** Pull the destination (payTo) address out of the agent's x402 payment header. */
export function payToFromPaymentHeader(paymentHeader) {
  const payload = parsePaymentPayloadFromHeader(paymentHeader);
  if (!payload) return null;
  return (
    payload?.payload?.authorization?.to ||
    payload?.authorization?.to ||
    payload?.accepted?.payTo ||
    null
  );
}

/**
 * Stripe-rail equivalent of handlePaidFetch, fully self-contained.
 *   - no payment header → mint + cache a deposit address, return a 402 whose
 *     payTo is that address.
 *   - payment header → confirm the buyer paid to an address we issued, then reuse
 *     the CDP verify+settle to land the transfer (Stripe captures it to fiat),
 *     record the grant (rail="stripe"), and serve the payload.
 *
 * @param payload object | async () => object (computed only after access granted)
 */
export async function handleStripeX402(context, product, payload) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;

  if (!stripeX402Enabled(env)) {
    return accessJson(
      {
        error: "stripe_rail_disabled",
        note: "Stripe machine-x402 is not enabled on this deployment. Use the CDP rail at /api/bar/x402/{slug}.",
        hint: "Set STRIPE_SECRET_KEY (requires a US business with the Stablecoins & Crypto payment method approved).",
      },
      503,
      CORS
    );
  }

  const resolvePayload = async () => (typeof payload === "function" ? await payload() : payload);
  const paymentHeader = readPaymentHeader(request);

  // ---- 402: mint a deposit address and ask the agent to pay it ----
  if (!paymentHeader) {
    const minted = await createCryptoDepositAddress(env, product.priceUsd);
    if (!minted.ok) {
      return accessJson(
        { error: "stripe_quote_failed", reason: minted.error, message: minted.message || null },
        502,
        CORS
      );
    }
    await cacheDepositAddress(env, {
      address: minted.address,
      paymentIntentId: minted.paymentIntentId,
      slug: product.slug,
      amountUsd: product.priceUsd,
    });

    // Reuse the CDP 402 builder, but with the Stripe deposit address as payTo.
    const requirements = buildProductPaymentRequirements(product, request.url, {
      ...env,
      X402_PAYTO: minted.address,
    });
    if (!requirements) {
      return accessJson({ error: "x402_not_configured" }, 503, CORS);
    }

    const body = payment402BodyForProduct(requirements, product, undefined, origin);
    body.rail = "stripe";
    body.stripe = { payment_intent: minted.paymentIntentId, capture: "auto_on_settle", settlement: "fiat" };
    return accessJson(body, 402, payment402Headers(requirements, undefined, { ...CORS, "Cache-Control": CACHE.payment402 }));
  }

  // ---- retry with payment: validate it targets an address we minted ----
  const payTo = payToFromPaymentHeader(paymentHeader);
  if (!payTo) {
    return accessJson({ error: "unparseable_payment_header" }, 400, CORS);
  }
  const issued = await lookupDepositAddress(env, payTo);
  if (!issued) {
    // Never settle to an address we did not mint (doc's paymentCache guard).
    return accessJson(
      { error: "unknown_deposit_address", note: "Payment targets an address this server did not issue. Re-request a fresh 402." },
      409,
      CORS
    );
  }

  const requirements = buildProductPaymentRequirements(product, request.url, { ...env, X402_PAYTO: payTo });
  if (!requirements) return accessJson({ error: "x402_not_configured" }, 503, CORS);

  const settled = await verifyAndSettlePayment(paymentHeader, requirements, env);
  if (!settled.ok) {
    if (settled.degraded) {
      return accessJson(paymentDegradedBody(origin, { retry_after_seconds: settled.retryAfter || 30 }), 503, {
        ...CORS,
        "Retry-After": String(settled.retryAfter || 30),
      });
    }
    const failBody = payment402BodyForProduct(requirements, product, "Payment verification failed.", origin);
    failBody.code = "payment_verification_failed";
    if (settled.invalidReason) failBody.invalidReason = settled.invalidReason;
    return accessJson(failBody, 402, payment402Headers(requirements, "Payment verification failed.", CORS));
  }

  if (settled.receipt?.transaction) {
    const prior = await findAccessGrantByTxRef(env, settled.receipt.transaction);
    if (prior) {
      return accessJson(
        { error: "payment_already_fulfilled", idempotent: true, grantId: prior.id, ...paymentDegradedBody(origin) },
        409,
        CORS
      );
    }
  }

  const grantId = await recordAccessGrant(env, {
    planId: product.kind,
    rail: "stripe",
    payerRef: settled.receipt.payer || null,
    txRef: settled.receipt.transaction || null,
    expiresAt: product.oneTime ? null : undefined,
    productKind: product.kind,
    productSlug: product.slug,
  });

  return accessJson(
    {
      ...(await resolvePayload()),
      access: "granted",
      scope: product.kind,
      rail: "stripe",
      one_time: Boolean(product.oneTime),
      grantId,
      receipt: settled.receipt,
      stripe: { payment_intent: issued.payment_intent_id, capture: "auto_on_settle", settlement: "fiat" },
      note: "Paid via the Stripe machine-x402 rail. Funds captured to the Stripe balance, not the CDP wallet.",
    },
    200,
    {
      ...CORS,
      "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE",
      "X-PAYMENT-RESPONSE": encodePaymentResponse(settled.receipt),
    }
  );
}
