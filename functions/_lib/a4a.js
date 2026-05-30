import { makeId } from "./review.js";

import {

  buildPaymentRequirements,

  verifyAndSettlePayment,

  X402_EXTENSION_URI,

} from "./x402.js";

import { getPlan, getAgentPlan, issueAccessToken } from "./access.js";

import {

  createA4ATask,

  getA4ATask,

  recordAccessGrant,

  updateA4ATask,

} from "./a4a-store.js";



export function wantsA4AExtension(request) {

  const raw = request.headers.get("X-A2A-Extensions") || "";

  return raw.split(",").map((s) => s.trim()).includes(X402_EXTENSION_URI);

}



export function a4aExtensionHeader() {

  return { "X-A2A-Extensions": X402_EXTENSION_URI };

}



export async function handleA4AJsonRpc(body, request, env) {

  if (!env.DB) {

    return jsonRpcError(body.id ?? null, -32603, "A4A store not configured (D1 binding missing)");

  }



  const method = body.method;

  const id = body.id ?? null;



  if (method === "message/send") {

    return jsonRpcResult(id, await handleMessageSend(body.params, request, env));

  }



  if (method === "tasks/get") {

    return jsonRpcResult(id, await handleTasksGet(body.params, env));

  }



  return jsonRpcError(id, -32601, "Method not found");

}



async function handleMessageSend(params, request, env) {

  const message = params?.message || {};

  const taskId = message.taskId;

  const metadata = message.metadata || {};

  const paymentStatus = metadata["x402.payment.status"];



  if (paymentStatus === "payment-submitted" && taskId) {

    return completePaymentTask(taskId, metadata, env);

  }



  const planId = readPlanFromMessage(message, request);

  const plan = getAgentPlan(planId);

  if (!plan) {

    return failedTask("Invalid access plan. Use annual.");

  }



  const requirements = buildPaymentRequirements(plan, request.url, env);

  if (!requirements) {

    return failedTask("Merchant wallet not configured (X402_PAYTO).");

  }



  const id = makeId("task");

  await createA4ATask(env, { id, planId: plan.id, requirements });



  return paymentRequiredTask(id, plan, requirements);

}



async function completePaymentTask(taskId, metadata, env) {

  const task = await getA4ATask(env, taskId);

  if (!task) {

    return failedTask("Unknown taskId", taskId);

  }



  if (task.status === "completed" && task.accessGrantId) {

    return completedTaskResponse(taskId, task.receipt, task.accessGrantId, env, task.planId);

  }



  if (task.expired || task.status === "expired") {

    return failedTask("Payment task expired. Start a new purchase.", taskId);

  }



  const plan = getPlan(task.planId);

  if (!plan) {

    return failedTask("Invalid plan on stored task", taskId);

  }



  const payload = metadata["x402.payment.payload"];

  const paymentHeader =

    typeof payload === "string" ? payload : JSON.stringify(payload ?? {});



  await updateA4ATask(env, taskId, {

    status: "payment-submitted",

    paymentPayloadJson: paymentHeader,

  });



  const settled = await verifyAndSettlePayment(

    paymentHeader,

    task.requirements,

    env

  );



  if (!settled.ok) {

    await updateA4ATask(env, taskId, {

      status: "failed",

      errorText: settled.error,

    });

    return {

      kind: "task",

      id: taskId,

      status: {

        state: "failed",

        message: {

          kind: "message",

          role: "agent",

          parts: [{ kind: "text", text: `Payment failed: ${settled.error}` }],

          metadata: {

            "x402.payment.status": "payment-failed",

            "x402.payment.error": settled.stage || "SETTLEMENT_FAILED",

          },

        },

      },

    };

  }



  const grantId = await recordAccessGrant(env, {

    planId: plan.id,

    rail: "a4a-x402",

    payerRef: settled.receipt.payer || null,

    txRef: settled.receipt.transaction || null,

    taskId,

    expiresAt: plan.durationDays

      ? new Date(Date.now() + plan.durationDays * 86400000).toISOString()

      : null,

  });



  const token = await issueAccessToken(plan, env, {

    rail: "a4a-x402",

    grantId,

    payer: settled.receipt.payer,

    tx: settled.receipt.transaction,

    taskId,

  });



  await updateA4ATask(env, taskId, {

    status: "completed",

    receiptJson: JSON.stringify(settled.receipt),

    accessGrantId: grantId,

  });



  return {

    kind: "task",

    id: taskId,

    status: {

      state: "completed",

      message: {

        kind: "message",

        role: "agent",

        parts: [

          {

            kind: "text",

            text: "Payment completed. Use the access token artifact for member endpoints.",

          },

        ],

        metadata: {

          "x402.payment.status": "payment-completed",

          "x402.payment.receipts": [settled.receipt],

        },

      },

    },

    artifacts: [

      {

        name: "second-eye-access",

        mimeType: "application/json",

        parts: [

          {

            kind: "text",

            text: JSON.stringify({

              accessToken: token,

              plan: plan.id,

              tokenType: "Bearer",

              grantId,

              taskId,

              statusUrl: "/api/access/status",

            }),

          },

        ],

      },

    ],

  };

}



async function completedTaskResponse(taskId, receipt, grantId, env, planId) {

  const plan = getPlan(planId);

  const token = await issueAccessToken(plan, env, {

    rail: "a4a-x402",

    grantId,

    taskId,

    replay: true,

  });



  return {

    kind: "task",

    id: taskId,

    status: {

      state: "completed",

      message: {

        metadata: {

          "x402.payment.status": "payment-completed",

          "x402.payment.receipts": receipt ? [receipt] : [],

        },

      },

    },

    artifacts: [

      {

        name: "second-eye-access",

        mimeType: "application/json",

        parts: [

          {

            kind: "text",

            text: JSON.stringify({

              accessToken: token,

              plan: planId,

              tokenType: "Bearer",

              grantId,

              taskId,

              statusUrl: "/api/access/status",

            }),

          },

        ],

      },

    ],

  };

}



async function handleTasksGet(params, env) {

  const taskId = params?.id;

  if (!taskId) return null;



  const task = await getA4ATask(env, taskId);

  if (!task) return null;



  if (task.status === "completed") {

    return {

      kind: "task",

      id: task.id,

      status: { state: "completed" },

    };

  }



  if (task.status === "failed" || task.status === "expired") {

    return {

      kind: "task",

      id: task.id,

      status: {

        state: "failed",

        message: {

          parts: [{ kind: "text", text: task.errorText || task.status }],

        },

      },

    };

  }



  return {

    kind: "task",

    id: task.id,

    status: {

      state: "input-required",

      message: {

        metadata: {

          "x402.payment.status": "payment-required",

          "x402.payment.required": task.requirements,

        },

      },

    },

  };

}



function paymentRequiredTask(id, plan, requirements) {

  return {

    kind: "task",

    id,

    status: {

      state: "input-required",

      message: {

        kind: "message",

        role: "agent",

        parts: [

          {

            kind: "text",

            text: `Payment required for Second Eye bar tab (${plan.label}, $${plan.priceUsd} USDC). Pay via x402 then retry with PAYMENT-SIGNATURE.`,

          },

        ],

        metadata: {

          "x402.payment.status": "payment-required",

          "x402.payment.required": requirements,

        },

      },

    },

  };

}



function readPlanFromMessage(message, request) {

  const url = new URL(request.url);

  const fromQuery = url.searchParams.get("plan");

  if (fromQuery) return fromQuery;



  for (const part of message.parts || []) {

    if (part.kind !== "text") continue;

    try {

      const parsed = JSON.parse(part.text);

      if (parsed.plan) return parsed.plan;

    } catch {

      /* plain text */

    }

  }



  return "annual";

}



function failedTask(text, taskId = makeId("task")) {

  return {

    kind: "task",

    id: taskId,

    status: {

      state: "failed",

      message: {

        kind: "message",

        role: "agent",

        parts: [{ kind: "text", text }],

      },

    },

  };

}



function jsonRpcResult(id, result) {

  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {

    status: 200,

    headers: {

      "Content-Type": "application/json",

      ...a4aExtensionHeader(),

    },

  });

}



function jsonRpcError(id, code, message) {

  return new Response(

    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),

    {

      status: 200,

      headers: {

        "Content-Type": "application/json",

        ...a4aExtensionHeader(),

      },

    }

  );

}



export { buildPaymentRequirements };


