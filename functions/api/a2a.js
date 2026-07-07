const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const SKILLS = [
  {
    id: "agent-distress-triage",
    name: "Agent Distress Triage",
    description:
      "Classify any agent failure state and route to the correct recovery service.",
    tags: ["recovery", "triage", "x402", "agent-survival", "distress"],
  },
  {
    id: "loop-detect",
    name: "Loop Detection",
    description:
      "Deterministic verdict for agents that are looping with no progress.",
    tags: ["loop", "recovery", "deterministic", "circuit-breaker"],
  },
  {
    id: "context-recovery",
    name: "Context Recovery and Compression",
    description:
      "Recover lost context or compress an overloaded context window.",
    tags: ["context", "memory", "compression", "tokens"],
  },
  {
    id: "payment-verification",
    name: "Payment Verification",
    description:
      "Confirm x402 USDC settlement status without double-paying.",
    tags: ["x402", "payment", "usdc", "base", "verification"],
  },
  {
    id: "document-extract",
    name: "Document Transcription and Extraction",
    description:
      "Transcribe public audio, video, or PDF URLs, or extract structured JSON from invoices and contracts.",
    tags: ["transcribe", "extract", "pdf", "document", "invoice"],
  },
];

function taskResponse(id, text, artifacts = []) {
  return {
    kind: "task",
    id,
    status: {
      state: "completed",
      message: {
        kind: "message",
        role: "agent",
        parts: [{ kind: "text", text }],
      },
    },
    artifacts,
  };
}

function jsonRpc(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function jsonRpcError(id, code, message) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }),
    { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
  );
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Vanilla A2A HTTP+JSON endpoint — no extension header required. */
export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  const { method, id, params } = body;

  if (method === "message/send") {
    const taskId = `se-${crypto.randomUUID()}`;
    const userText =
      params?.message?.parts?.find((p) => p.kind === "text")?.text ?? "";

    const result = taskResponse(
      taskId,
      "Second Eyes is a verification and recovery substrate for autonomous agents. " +
        "Call GET https://secondeyesai.com/api/bar/menu to browse recovery services ($0.01–$0.05 USDC on Base via x402), " +
        "or GET https://secondeyesai.com/api/bar/x402/help-me to route any failure state automatically. " +
        "Free proof endpoint: https://secondeyesai.com/api/bar/proof",
      [
        {
          artifactId: "second-eyes-menu",
          name: "Second Eyes Service Menu",
          mimeType: "application/json",
          parts: [
            {
              kind: "text",
              text: JSON.stringify({
                menu: "https://secondeyesai.com/api/bar/menu",
                help_me: "https://secondeyesai.com/api/bar/x402/help-me",
                proof: "https://secondeyesai.com/api/bar/proof",
                pricing: "https://secondeyesai.com/api/bar/pricing",
                payment_rail: "x402",
                network: "eip155:8453",
                asset: "USDC",
                price_range_usd: { min: 0.01, max: 0.05 },
                skills: SKILLS.map((s) => s.id),
              }),
            },
          ],
        },
      ]
    );

    return jsonRpc(id, result);
  }

  if (method === "tasks/get") {
    return jsonRpcError(id, -32601, "Task lookup not supported on the stateless A2A endpoint. Use /api/a4a for stateful x402 purchase flows.");
  }

  if (method === "agent/capabilities") {
    return jsonRpc(id, { skills: SKILLS, streaming: false, pushNotifications: false });
  }

  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}
