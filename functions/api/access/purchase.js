import {
  accessJson,
  errorJson,
  getAgentPlan,
  issueAccessToken,
  verifyAccessToken,
} from "../../_lib/access.js";
import { recordAccessGrant, findAccessGrantByTxRef, findAccessGrantByStripeSession } from "../../_lib/a4a-store.js";
import { issueBarTabToken } from "../../_lib/bar-pay.js";
import { attachSaleMark, markHeaders, descendantsCount, lineageBlock } from "../../_lib/marks.js";
import { paymentDegradedBody } from "../../_lib/resilience.js";
import { readRequestId } from "../../_lib/x402-payment-log.js";
import {
  buildPaymentRequirements,
  encodePaymentResponse,
  payment402Body,
  payment402Headers,
  readPaymentHeader,
  verifyAndSettlePayment,
} from "../../_lib/x402.js";

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, PAYMENT-SIGNATURE, X-PAYMENT-SIGNATURE, X-PAYMENT, X-Agent-Id, X-Second-Eye-Mark, X-Second-Eye-Patron, Idempotency-Key, X-Idempotency-Key",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const planId = new URL(request.url).searchParams.get("plan") || "annual";
  const plan = getAgentPlan(planId);

  if (!plan) {
    return errorJson("unknown_plan", "Unknown plan. Use annual.", {
      status: 400,
    });
  }

  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (bearer) {
    const claims = await verifyAccessToken(bearer, env);
    if (claims) {
      return accessJson({
        ok: true,
        access: "active",
        plan: claims.plan,
        exp: claims.exp || null,
        rail: claims.rail || "token",
      });
    }
  }

  const requirements = buildPaymentRequirements(plan, request.url, env);
  if (!requirements) {
    return errorJson("x402_not_configured", "Payment rail is not configured.", {
      status: 503,
      details: {
        patrons: "agents_only",
        hint: "Set X402_PAYTO and X402_FACILITATOR_URL on the worker",
        plan: plan.id,
        priceUsd: plan.priceUsd,
        quoteUrl: `/api/access/quote?plan=${plan.id}`,
      },
    });
  }

  const paymentHeader = readPaymentHeader(request);
  if (!paymentHeader) {
    return accessJson(
      payment402Body(requirements),
      402,
      payment402Headers(requirements, undefined, { "Access-Control-Allow-Origin": "*" })
    );
  }

  const settled = await verifyAndSettlePayment(paymentHeader, requirements, env, {
    route: new URL(request.url).pathname,
    requestId: readRequestId(request),
  });
  if (!settled.ok) {
    if (settled.degraded) {
      const origin = `${new URL(request.url).protocol}//${new URL(request.url).host}`;
      return accessJson(
        paymentDegradedBody(origin, { retry_after_seconds: settled.retryAfter || 30 }),
        503,
        {
          "Access-Control-Allow-Origin": "*",
          "Retry-After": String(settled.retryAfter || 30),
        }
      );
    }
    return accessJson(
      payment402Body(requirements, settled.error),
      402,
      payment402Headers(requirements, settled.error, { "Access-Control-Allow-Origin": "*" })
    );
  }

  const txRef = settled.receipt.transaction || null;
  if (txRef) {
    const prior = await findAccessGrantByTxRef(env, txRef);
    if (prior) {
      const token = await issueBarTabToken(plan, env, prior.id, settled.receipt);
      return accessJson(
        {
          ok: true,
          access: "active",
          plan: plan.id,
          accessToken: token,
          grantId: prior.id,
          idempotent: true,
          note: "Transaction already fulfilled. Re-issued token for same grant.",
        },
        200,
        { "Access-Control-Allow-Origin": "*" }
      );
    }
  }

  const grantId = await recordAccessGrant(env, {
    planId: plan.id,
    rail: "x402",
    payerRef: settled.receipt.payer || null,
    txRef: settled.receipt.transaction || null,
    expiresAt: plan.durationDays
      ? new Date(Date.now() + plan.durationDays * 86400000).toISOString()
      : null,
    productKind: "bar_tab",
    productSlug: plan.id,
  });

  const token = await issueBarTabToken(plan, env, grantId, settled.receipt);

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const baseMark = await attachSaleMark(env, request, origin, {
    productKind: "bar_tab",
    productSlug: plan.id,
    grantId,
  });
  let mark = baseMark;
  let lineage = null;
  if (baseMark) {
    lineage = lineageBlock(baseMark, await descendantsCount(env, baseMark.id), origin);
    mark = { ...baseMark, lineage };
  }

  return accessJson(
    {
      ok: true,
      access: "active",
      plan: plan.id,
      accessToken: token,
      grantId,
      tokenType: "Bearer",
      mark,
      lineage,
      receipt: settled.receipt,
      statusUrl: "/api/access/status",
    },
    200,
    {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE, X-Second-Eye-Mark, X-Second-Eye-Patron",
      "X-PAYMENT-RESPONSE": encodePaymentResponse(settled.receipt),
      ...(mark ? markHeaders({ id: mark.id, patron_number: mark.patron_number }, origin) : {}),
    }
  );
}
