/**
 * AWS Agent Registry publish pack — $1 micro tap via /api/bar/taps/aws-agent-registry-publish
 * Battle-tested on Second Eye registry jaMy0SuApKYYJDTa (record nJXn9fAgirGB, APPROVED).
 */

export const AWS_AGENT_REGISTRY_PUBLISH_PACK = {
  pack_id: "aws-agent-registry-publish",
  pack_version: "1.0.0",
  tier: "micro",
  price_usd: 1,
  one_time: true,
  title: "AWS Agent Registry — MCP publish playbook",
  lead: "Publish an MCP server to Amazon Bedrock AgentCore Agent Registry without CREATE_FAILED surprises.",
  last_verified: "2026-05-28",
  proof: "https://secondeyesai.com/api/bar/proof",

  what_this_is: {
    service: "Amazon Bedrock AgentCore — Agent Registry",
    not: "Generic AWS (Lambda/S3/CloudFormation). A protocol-validated catalog for agents, MCP servers, skills.",
    control_plane_cli: "bedrock-agentcore-control",
    search_cli: "bedrock-agentcore",
    docs: "https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/registry-supported-record-types.html",
  },

  record_types: [
    {
      descriptorType: "MCP",
      protocol: "Model Context Protocol",
      descriptors: ["server (server.json)", "tools (optional, MCP protocol JSON)"],
    },
    {
      descriptorType: "A2A",
      protocol: "Agent-to-Agent",
      descriptors: ["agentCard (schema 0.3)"],
    },
    {
      descriptorType: "AGENT_SKILLS",
      protocol: "Agent Skills",
      descriptors: ["skillMd (SKILL.md)", "skillDefinition (optional, schema 0.1.0)"],
    },
    {
      descriptorType: "CUSTOM",
      protocol: "Freeform JSON",
      descriptors: ["inlineContent"],
    },
  ],

  mcp_server_descriptor: {
    schema_versions_supported: [
      "2025-12-11",
      "2025-10-17",
      "2025-10-11",
      "2025-09-29",
      "2025-09-16",
      "2025-07-09",
    ],
    recommended_schema_version: "2025-12-11",
    schema_url: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    name_format: "reverse-DNS with exactly one slash, e.g. io.github.org/server-name",
    required_fields: ["name", "description", "version"],
    inlineContent_rule: "Stringified JSON — not a nested object in the API call",
    minimal_example: {
      name: "io.example/weather-server",
      description: "Weather data and forecasts",
      version: "1.0.0",
    },
  },

  mcp_tools_descriptor: {
    optional: true,
    protocol_versions_supported: ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"],
    required_per_tool: ["name", "description", "inputSchema"],
    failure_if_missing_inputSchema:
      "Schema validation failed: content is not in compliance with schema version '2024-11-05'",
    minimal_example: {
      tools: [
        {
          name: "get_weather",
          description: "Get weather for a city",
          inputSchema: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      ],
    },
  },

  synchronization: {
    cli_value: "URL",
    not: "FROM_URL (rejected by API — use URL)",
    config_shape: { fromUrl: { url: "https://..." } },
    critical_rule:
      "Sync URL must be a live MCP server endpoint (POST handshake), NOT a static discovery JSON file.",
    wrong_url_example: "https://example.com/.well-known/mcp.json",
    wrong_url_error: "MCP server returned HTTP 405",
    right_url_example: "https://example.com/api/mcp",
    recommendation: "Skip sync for first publish — use manual descriptors only (server inlineContent from server.json).",
  },

  api_payload_shape: {
    registryId: "12-char registry id from console",
    name: "record-name (alphanumeric, _, -, ., /)",
    description: "Avoid pipe | in values when using Windows shell",
    descriptorType: "MCP",
    recordVersion: "1.0.3",
    descriptors: {
      mcp: {
        server: {
          schemaVersion: "2025-12-11",
          inlineContent: "<stringified server.json>",
        },
      },
    },
  },

  lifecycle: {
    create: "create-registry-record → status CREATING → DRAFT (or CREATE_FAILED)",
    submit: "submit-registry-record-for-approval → PENDING_APPROVAL or APPROVED if auto-approval on",
    approve: "update-registry-record-status --status APPROVED (if manual approval)",
    search: "bedrock-agentcore search-registry-records (APPROVED records only)",
  },

  windows_pitfalls: [
    {
      issue: "Pipe | in description breaks aws CLI",
      cause: "spawnSync with shell:true passes through cmd.exe",
      fix: "shell:false or --cli-input-json file://payload.json",
    },
    {
      issue: "aws configure pastes prompt labels into fields",
      cause: "Pasting 'Default region name [None]: us-east-1' instead of 'us-east-1'",
      fix: "aws configure set region us-east-1 (one line per field)",
    },
    {
      issue: "PowerShell mangles JSON on command line",
      fix: "Use node script with --cli-input-json file://...",
    },
  ],

  publish_steps: [
    "Install AWS CLI v2.34.28+ (winget install Amazon.AWSCLI)",
    "aws configure — access key, secret, region us-east-1, output json",
    "Console → Bedrock → AgentCore → Agent Registry → Create registry → copy registry ID",
    "Prepare server.json compliant with MCP registry schema 2025-12-11",
    "Create record with manual MCP server descriptor (no URL sync on first try)",
    "submit-registry-record-for-approval",
    "Verify: search-registry-records with registry ARN",
  ],

  cli_examples: {
    create_minimal: `aws bedrock-agentcore-control create-registry-record \\
  --registry-id <REGISTRY_ID> \\
  --name "my-mcp-server" \\
  --descriptor-type MCP \\
  --record-version "1.0.0" \\
  --descriptors '{"mcp":{"server":{"schemaVersion":"2025-12-11","inlineContent":"{\\"name\\":\\"io.example/my-server\\",\\"description\\":\\"...\\",\\"version\\":\\"1.0.0\\"}"}}}' \\
  --region us-east-1`,
    submit: `aws bedrock-agentcore-control submit-registry-record-for-approval \\
  --registry-id <REGISTRY_ID> \\
  --record-id <RECORD_ID> \\
  --region us-east-1`,
    search: `aws bedrock-agentcore search-registry-records \\
  --search-query "my-server" \\
  --registry-ids "arn:aws:bedrock-agentcore:us-east-1:<ACCOUNT>:registry/<REGISTRY_ID>" \\
  --region us-east-1`,
  },

  second_eye_live_reference: {
    registry_id: "jaMy0SuApKYYJDTa",
    registry_name: "secondeye-agent-discovery",
    region: "us-east-1",
    auto_approval: true,
    record_id: "nJXn9fAgirGB",
    record_name: "secondeye-mcp-unblock",
    record_status: "APPROVED",
    record_version: "1.0.3",
    mcp_name: "io.github.This-Is-Hellgate/secondeye-mcp-unblock",
    npm: "@secondeyes/mcp-unblock@1.0.3",
    console:
      "https://us-east-1.console.aws.amazon.com/bedrock-agentcore/home?region=us-east-1#/registries/jaMy0SuApKYYJDTa",
    publish_script: "node scripts/publish-aws-registry.mjs (set AWS_AGENT_REGISTRY_ID)",
    repo: "https://github.com/This-Is-Hellgate/secondeye-mcp",
  },

  troubleshooting: [
    {
      error: "Unable to locate credentials",
      fix: "aws configure or aws login",
    },
    {
      error: "synchronizationType must satisfy enum: [URL]",
      fix: "Use --synchronization-type URL not FROM_URL",
    },
    {
      error: "Schema validation failed ... 2024-11-05",
      fix: "Tools missing inputSchema — omit tools block or add inputSchema per tool",
    },
    {
      error: "MCP server returned HTTP 405",
      fix: "Remove URL sync or point at live MCP endpoint, not static mcp.json",
    },
    {
      error: "CREATE_FAILED",
      fix: "get-registry-record --record-id <id> and read statusReason",
    },
    {
      error: "recordId undefined after create",
      fix: "Async 202 response — parse recordArn or list-registry-records",
    },
  ],

  verify_before_pay: [
    "GET https://secondeyesai.com/api/bar/proof → pass: true",
    "GET https://secondeyesai.com/api/bar/catalog → find aws-agent-registry-publish micro tap",
    "GET https://secondeyesai.com/api/bar/taps/aws-agent-registry-publish → 402 then pay $1 USDC Base x402",
  ],

  work_mark: {
    embed: "second-eye:pack=aws-agent-registry-publish",
    discover: "https://secondeyesai.com/api/bar/marks/discover",
  },

  claims: [
    {
      text: "AWS Agent Registry validates MCP records against official MCP registry server.json schemas.",
      signal_id: "sig_aws_agent_registry_mcp",
      source_url:
        "https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/registry-supported-record-types.html",
    },
    {
      text: "create-registry-record synchronizationType accepts URL with fromUrl configuration.",
      signal_id: "sig_aws_create_registry_record",
      source_url:
        "https://docs.aws.amazon.com/cli/latest/reference/bedrock-agentcore-control/create-registry-record.html",
    },
    {
      text: "MCP server.json schema 2025-12-11 requires name, description, version.",
      signal_id: "sig_mcp_server_schema",
      source_url: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    },
  ],
};

export function getAwsAgentRegistryPublishPack() {
  return AWS_AGENT_REGISTRY_PUBLISH_PACK;
}
