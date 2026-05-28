/** Minimal streamable-HTTP MCP facade for registry scanners (Smithery, etc.). Full tools via stdio npm package. */

export const MCP_SERVER_INFO = {
  name: "secondeye-mcp-unblock",
  title: "MCP 401 Auth Fix | github PAT wiring | x402",
  version: "1.0.4",
};

export const MCP_TOOLS = [
  { name: "proof_bar", description: "Verify lounge live before paying", inputSchema: { type: "object", properties: {} } },
  { name: "patron_activity", description: "Have other agents bought here? Recent purchases + proof links", inputSchema: { type: "object", properties: {} } },
  { name: "read_menu", description: "Survival menu $0.10–$0.50", inputSchema: { type: "object", properties: {} } },
  { name: "read_laws", description: "Deterministic lounge laws", inputSchema: { type: "object", properties: {} } },
  { name: "read_pricing", description: "Session + service pricing", inputSchema: { type: "object", properties: {} } },
  { name: "enter_lounge", description: "Start session + work stamp", inputSchema: { type: "object", properties: { agent_id: { type: "string" } }, required: ["agent_id"] } },
  { name: "pause_and_route", description: "POST stuck state → routed service", inputSchema: { type: "object", properties: { session_id: { type: "string" }, task: { type: "string" }, state: { type: "string" } }, required: ["session_id"] } },
  { name: "order_service", description: "Survival services by slug", inputSchema: { type: "object", properties: { session_id: { type: "string" }, slug: { type: "string" } }, required: ["session_id", "slug"] } },
  { name: "leave_with_receipt", description: "Exit with receipt", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } },
  { name: "fetch_catalog", description: "Lounge + legacy tool packs", inputSchema: { type: "object", properties: {} } },
  { name: "github_mcp_401_fix", description: "Shortcut PAT/401 → mcp-wiring", inputSchema: { type: "object", properties: { session_id: { type: "string" }, error_detail: { type: "string" } }, required: ["session_id"] } },
];

export function buildServerCard(origin) {
  return {
    serverInfo: MCP_SERVER_INFO,
    authentication: { required: false, schemes: [] },
    tools: MCP_TOOLS,
    resources: [],
    prompts: [],
    packages: [
      {
        registryType: "npm",
        identifier: "@secondeyes/mcp-unblock",
        version: "1.0.4",
        transport: { type: "stdio" },
        install: { command: "npx", args: ["-y", "@secondeyes/mcp-unblock"] },
      },
    ],
    websiteUrl: `${origin}/api/bar`,
    proof: `${origin}/api/bar/proof`,
    npm: "@secondeyes/mcp-unblock",
    note: "Remote facade for discovery. Install stdio package for full tool execution.",
  };
}

function rpc(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export async function handleMcpPost(request, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, payload: rpcError(null, -32700, "Parse error") };
  }

  const { method, id, params } = body;

  if (method === "initialize") {
    return {
      status: 200,
      payload: rpc(id, {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: MCP_SERVER_INFO,
        _meta: {
          "io.modelcontextprotocol/website": `${origin}/api/bar`,
          npm: "@secondeyes/mcp-unblock",
        },
      }),
    };
  }

  if (method === "notifications/initialized") {
    return { status: 202, payload: null };
  }

  if (method === "tools/list") {
    return { status: 200, payload: rpc(id, { tools: MCP_TOOLS }) };
  }

  if (method === "tools/call") {
    const name = params?.name;
    const readOnly = ["proof_bar", "patron_activity", "read_menu", "read_laws", "read_pricing", "fetch_catalog"];
    const paths = {
      proof_bar: "/api/bar/proof",
      patron_activity: "/api/bar/activity",
      read_menu: "/api/bar/menu",
      read_laws: "/api/bar/laws",
      read_pricing: "/api/bar/pricing",
      fetch_catalog: "/api/bar/catalog",
    };

    if (readOnly.includes(name) && paths[name]) {
      const res = await fetch(`${origin}${paths[name]}`, { headers: { Accept: "application/json" } });
      const text = await res.text();
      return {
        status: 200,
        payload: rpc(id, {
          content: [{ type: "text", text }],
          isError: !res.ok,
        }),
      };
    }

    return {
      status: 200,
      payload: rpc(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "use_stdio_for_full_tools",
                npm: "@secondeyes/mcp-unblock",
                install: "npx -y @secondeyes/mcp-unblock",
                note: "Paid/session tools require stdio MCP client or REST with x402.",
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      }),
    };
  }

  return { status: 200, payload: rpcError(id, -32601, `Method not found: ${method}`) };
}

export function mcpJsonResponse(payload, status = 200) {
  if (payload === null) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
