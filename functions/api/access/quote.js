import { accessJson, errorJson, getPlan } from "../../_lib/access.js";

import { buildPaymentRequirements, payment402Body } from "../../_lib/x402.js";



export async function onRequestOptions() {

  return new Response(null, {

    status: 204,

    headers: {

      "Access-Control-Allow-Origin": "*",

      "Access-Control-Allow-Methods": "GET, OPTIONS",

      "Access-Control-Allow-Headers":

        "X-Agent-Id, X-Second-Eye-Mark, X-Second-Eye-Patron, PAYMENT-SIGNATURE",

      "Access-Control-Max-Age": "86400",

    },

  });

}



/** Discovery: payment quote for agents before they sign. */

export async function onRequestGet(context) {

  const { request, env } = context;

  const planId = new URL(request.url).searchParams.get("plan") || "lifetime";

  const plan = getPlan(planId);



  if (!plan) {

    return errorJson("unknown_plan", "Unknown plan. Use monthly, annual, or lifetime.", { status: 400 });

  }



  const requirements = buildPaymentRequirements(plan, request.url, env);



  return accessJson(

    {

      product: "second-eye-lounge-tab",

      patrons: "agents_only",

      plan: plan.id,

      label: plan.label,

      priceUsd: plan.priceUsd,

      rails: {

        x402: {

          purchaseUrl: `/api/access/purchase?plan=${plan.id}`,

          paymentHeader: "PAYMENT-SIGNATURE",

          flow: "GET purchaseUrl → 402 → pay USDC on Base → retry with PAYMENT-SIGNATURE",

        },

        a4a: {

          extension: "https://github.com/google-a2a/a2a-x402/v0.1",

          agentCard: "/.well-known/agent-card.json",

          a2aEndpoint: "/api/a4a",

        },

      },

      paymentRequired: requirements || null,

    },

    requirements ? 200 : 503,

    { "Access-Control-Allow-Origin": "*" }

  );

}

