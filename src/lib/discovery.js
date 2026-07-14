/**
 * Discovery generation — openapi.json, the x402 resources document, and
 * /.well-known/x402 are ALL generated from the curated index (curation.js).
 * One source; surfaces cannot drift: what is curated live is what is
 * advertised — stubs only on free surfaces, never guidance or the graph.
 *
 * The bazaar block is built by the OFFICIAL @x402/extensions helper, which is
 * exactly what dissolves the hand-rolled-discovery risk the legacy stack
 * carried (and the CDP resource-indexing gap x402#2821 flagged).
 */
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { SERVICE_NAME, SERVICE_DESCRIPTION, TAGLINE, CANONICAL_ORIGIN } from "./brand.js";
import { liveStubs, parseMaybeJson } from "./curation.js";
import { activeNetwork, activePayTo } from "./networks.js";

export function discoveryJson(obj, extraHeaders = {}) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
      ...extraHeaders,
    },
  });
}

function doorPath(stub) {
  return `/api/x402/${stub.slug || stub.sku}`;
}

/** POST-shaped door (state in → verdict out) vs. GET-shaped resolved guidance. */
function isPostDoor(stub) {
  return stub.invoke_kind === "verdict" || stub.invoke_kind === "workersai";
}

/** The bazaar discovery block for one door — official helper output only. */
export function toolBazaarExtension(stub) {
  if (isPostDoor(stub)) {
    return declareDiscoveryExtension({
      type: "http",
      method: "POST",
      bodyType: "json",
      input: parseMaybeJson(stub.input_example) || { state: "describe what you are stuck on" },
      inputSchema: parseMaybeJson(stub.input_schema) || {
        properties: {
          state: { type: "string", description: "the agent's current state, in its own words" },
        },
        required: ["state"],
      },
      output: {
        type: "json",
        example: {
          sku: stub.sku,
          recommendation: "stop",
          reason: "why this verdict",
          guidance: { stop: "", preserve: "", continue: "" },
        },
        schema: {
          type: "object",
          properties: {
            sku: { type: "string" },
            recommendation: { type: "string" },
            reason: { type: "string" },
            guidance: { type: "object" },
          },
          required: ["sku", "recommendation"],
        },
      },
    });
  }
  // GET doors sell the RESOLVED CAPABILITY: guidance + the wired composition —
  // never a raw blob.
  return declareDiscoveryExtension({
    type: "http",
    method: "GET",
    output: {
      type: "json",
      example: {
        sku: stub.sku,
        name: stub.name,
        item_type: stub.item_type,
        summary: String(stub.summary || "").slice(0, 200),
        guidance: "when to reach for this item, how to wire it, the gotchas",
        composition: { steps: [], composes_with: [], requires: [], alternatives: [] },
        content_hash: stub.content_hash,
      },
      schema: {
        type: "object",
        properties: {
          sku: { type: "string" },
          name: { type: "string" },
          kind: { type: "string" },
          summary: { type: "string" },
          guidance: { type: "string" },
          composition: { type: "object" },
          invoke: { type: "object" },
          content_hash: { type: "string" },
        },
        required: ["sku", "name", "guidance", "composition"],
      },
    },
  });
}

function usdToMicros(usd) {
  return String(Math.round(usd * 1_000_000));
}

/** JSON Schemas for every response shape this service returns. */
function componentSchemas() {
  return {
    CheckStub: {
      type: "object",
      description: "One live catalog item as listed on the free listing.",
      properties: {
        sku: { type: "string" },
        name: { type: "string" },
        kind: { type: "string" },
        service: { type: "string" },
        price_usd: { type: "number" },
        summary: { type: "string" },
        url: { type: "string", format: "uri", description: "The paid endpoint for this item." },
      },
      required: ["sku", "name", "price_usd", "summary", "url"],
    },
    ChecksListing: {
      type: "object",
      description: "Free listing of every live catalog item.",
      properties: {
        service: { type: "string" },
        tagline: { type: "string" },
        total_live: { type: "integer" },
        payment: {
          type: "object",
          properties: {
            rail: { type: "string", const: "x402" },
            network: { type: "string" },
            asset: { type: "string", const: "USDC" },
            how: { type: "string" },
          },
        },
        checks: { type: "array", items: { $ref: "#/components/schemas/CheckStub" } },
      },
      required: ["service", "total_live", "checks"],
    },
    Proof: {
      type: "object",
      description: "Free liveness proof: inventory reachability, live item count, payment rail configuration.",
      properties: {
        service: { type: "string" },
        status: { type: "string", enum: ["live", "degraded"] },
        checks_live: { type: ["integer", "null"] },
        payment: {
          type: "object",
          properties: {
            rail: { type: "string", const: "x402" },
            x402Version: { type: "integer", const: 2 },
            network: { type: "string" },
            asset: { type: "string", const: "USDC" },
            payTo_configured: { type: "boolean" },
            facilitator_configured: { type: "boolean" },
          },
        },
        discovery: {
          type: "object",
          properties: {
            checks: { type: "string", format: "uri" },
            openapi: { type: "string", format: "uri" },
            x402_resources: { type: "string", format: "uri" },
            well_known: { type: "string", format: "uri" },
          },
        },
      },
      required: ["service", "status"],
    },
    ResolvedCapability: {
      type: "object",
      description:
        "The paid response: the resolved, invocable capability — guidance (when/how/why), the composition graph around it (steps, composes_with, requires, alternatives, each with the one-line why), and invocation instructions. Not a file dump.",
      properties: {
        sku: { type: "string" },
        name: { type: "string" },
        kind: { type: "string" },
        service: { type: "string" },
        summary: { type: "string" },
        guidance: { type: "string", description: "The editorial layer: when to reach for this item, wiring, gotchas." },
        composition: {
          type: "object",
          description: "The item's wired graph neighborhood — curation as data.",
          properties: {
            steps: { type: "array", items: { type: "object" } },
            composes_with: { type: "array", items: { type: "object" } },
            requires: { type: "array", items: { type: "object" } },
            alternatives: { type: "array", items: { type: "object" } },
            pairs_with: { type: "array", items: { type: "object" } },
            part_of: { type: "array", items: { type: "object" } },
          },
        },
        invoke: {
          type: "object",
          description: "How to run it — POST state contract for verdict/AI checks, deliberate artifact fetch for file items.",
        },
        content_hash: { type: "string" },
        version: { type: "integer" },
      },
      required: ["sku", "name", "guidance", "composition"],
    },
    Verdict: {
      type: "object",
      description: "The paid response for a POST-shaped check: a stop/preserve/continue verdict for the described state.",
      properties: {
        sku: { type: "string" },
        name: { type: "string" },
        recommendation: { type: "string", enum: ["stop", "preserve", "continue"] },
        reason: { type: "string" },
        guidance: {
          type: "object",
          properties: { stop: { type: "string" }, preserve: { type: "string" }, continue: { type: "string" } },
        },
        escalate_if: { type: "string" },
        confidence: { type: "number" },
      },
      required: ["sku", "recommendation"],
    },
    PaymentRequired402: {
      type: "object",
      description:
        "x402 v2 unpaid response body (the protocol object rides base64-encoded in the PAYMENT-REQUIRED header).",
      properties: {
        x402Version: { type: "integer", const: 2 },
        error: { type: "string" },
        resource: { type: "object" },
        accepts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              scheme: { type: "string" },
              network: { type: "string" },
              amount: { type: "string" },
              asset: { type: "string" },
              payTo: { type: "string" },
              maxTimeoutSeconds: { type: "integer" },
              extra: { type: "object" },
            },
            required: ["scheme", "network"],
          },
        },
        extensions: { type: "object" },
      },
      required: ["x402Version", "accepts"],
    },
    NotFound: {
      type: "object",
      description: "Unknown SKU or slug.",
      properties: {
        error: { type: "string", const: "unknown_sku" },
        checks: { type: "string", description: "Path of the free checks listing." },
      },
      required: ["error"],
    },
    MethodNotAllowed: {
      type: "object",
      description: "Teaching 405: the method an item expects (GET for guidance items, POST for checks).",
      properties: {
        error: { type: "string", const: "method_not_allowed" },
        method: { type: "string" },
        path: { type: "string" },
        hint: { type: "string" },
        docs: { type: "object" },
      },
      required: ["error", "method", "path"],
    },
  };
}

function jsonContent(ref) {
  return { "application/json": { schema: { $ref: ref } } };
}

function paidResponses(stub) {
  const okSchema = stub && isPostDoor(stub) ? "#/components/schemas/Verdict" : "#/components/schemas/ResolvedCapability";
  return {
    200: {
      description: "Paid. Body carries the verdict (checks) or the resolved capability (guidance items).",
      content: jsonContent(okSchema),
    },
    402: {
      description:
        "Unpaid. PAYMENT-REQUIRED header carries base64 JSON payment requirements (x402 v2); retry the same URL with PAYMENT-SIGNATURE.",
      headers: {
        "PAYMENT-REQUIRED": { description: "Base64-encoded x402 v2 PaymentRequired object.", schema: { type: "string" } },
      },
      content: jsonContent("#/components/schemas/PaymentRequired402"),
    },
    404: { description: "Unknown SKU or slug.", content: jsonContent("#/components/schemas/NotFound") },
    405: { description: "Wrong method for this item.", content: jsonContent("#/components/schemas/MethodNotAllowed") },
  };
}

export async function buildOpenApi(env, origin = CANONICAL_ORIGIN) {
  const doors = await liveStubs(env);
  const paths = {};

  for (const stub of doors) {
    if (isPostDoor(stub)) {
      paths[doorPath(stub)] = {
        post: {
          operationId: `${stub.slug || stub.sku}_post`,
          summary: String(stub.summary || "").slice(0, 120),
          description: `${stub.summary} Paid check — POST your state (USDC via x402), get a verdict. Settlement happens only when the check returns successfully. ~$${stub.price_usd} USDC.`,
          tags: ["paid", "x402", "check", stub.item_type, stub.service_slug].filter(Boolean),
          "x-price-usd": stub.price_usd,
          security: [{ x402Payment: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: parseMaybeJson(stub.input_schema) || {
                  type: "object",
                  properties: {
                    state: { type: "string", description: "the agent's current state, in its own words" },
                  },
                  required: ["state"],
                },
              },
            },
          },
          responses: {
            200: { description: "Paid and checked. Body carries the verdict.", content: jsonContent("#/components/schemas/Verdict") },
            402: paidResponses(stub)[402],
            404: paidResponses(stub)[404],
            405: paidResponses(stub)[405],
          },
        },
      };
      continue;
    }
    paths[doorPath(stub)] = {
      get: {
        operationId: `${stub.slug || stub.sku}_get`,
        summary: String(stub.summary || "").slice(0, 120),
        description: `${stub.summary} Session-less x402 paid endpoint — pay once (USDC) and receive the resolved capability: guidance, composition, invocation. ~$${stub.price_usd} USDC.`,
        tags: ["paid", "x402", stub.item_type, stub.service_slug].filter(Boolean),
        "x-price-usd": stub.price_usd,
        security: [{ x402Payment: [] }],
        responses: paidResponses(stub),
      },
    };
    if (stub.invoke_kind === "r2") {
      paths[`${doorPath(stub)}/artifact`] = {
        get: {
          operationId: `${stub.slug || stub.sku}_artifact_get`,
          summary: `Artifact for ${stub.name} (deliberate secondary fetch).`,
          description: `The genuine file artifact behind ${stub.name}. Reached through the resolved capability; same x402 gate.`,
          tags: ["paid", "x402", "artifact", stub.service_slug].filter(Boolean),
          "x-price-usd": stub.price_usd,
          security: [{ x402Payment: [] }],
          responses: {
            200: {
              description: "Paid. Body is the artifact itself (binary).",
              content: { [stub.mime_type || "application/octet-stream"]: { schema: { type: "string", format: "binary" } } },
            },
            402: paidResponses(stub)[402],
            404: paidResponses(stub)[404],
          },
        },
      };
    }
  }

  paths["/api/x402/{sku}"] = {
    get: {
      operationId: "item_by_sku_get",
      summary: "Paid item by SKU or slug (x402).",
      description:
        "Session-less paid endpoint. First call returns 402 with payment requirements in the PAYMENT-REQUIRED header; sign USDC on Base and retry the same URL with PAYMENT-SIGNATURE.",
      tags: ["paid", "x402"],
      parameters: [
        { name: "sku", in: "path", required: true, description: "Item SKU or slug — both resolve.", schema: { type: "string" } },
      ],
      security: [{ x402Payment: [] }],
      responses: paidResponses(),
    },
  };

  paths["/api/checks"] = {
    get: {
      operationId: "checks_get",
      summary: "Free listing of every live catalog item with SKU, type, price, and summary.",
      description: "Free, unpaid surface. The place to browse before paying.",
      tags: ["free", "discovery"],
      security: [],
      responses: {
        200: { description: "The live checks listing.", content: jsonContent("#/components/schemas/ChecksListing") },
        405: { description: "Wrong method.", content: jsonContent("#/components/schemas/MethodNotAllowed") },
      },
    },
  };

  paths["/api/proof"] = {
    get: {
      operationId: "proof_get",
      summary: "Free liveness proof: live item count, payment rail configuration, inventory reachability.",
      description: "Free, unpaid surface. Confirm the service is live before spending.",
      tags: ["free", "discovery"],
      security: [],
      responses: {
        200: { description: "Liveness proof.", content: jsonContent("#/components/schemas/Proof") },
        405: { description: "Wrong method.", content: jsonContent("#/components/schemas/MethodNotAllowed") },
      },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: `${SERVICE_NAME} — preflight checks for agents, paid per call`,
      summary: TAGLINE,
      description:
        `${SERVICE_DESCRIPTION}. Second Eyes sells small, session-less verification checks to autonomous agents: describe your state — looping, drifting, low on context, about to use a tool, about to spend — and get back a deterministic verdict with a receipt. Discover, pay USDC on Base via x402 v2, use.`,
      version: "2.0.0",
      "x-audience": "autonomous_agents",
      contact: { url: `${origin}/llms.txt` },
    },
    servers: [{ url: origin }],
    components: {
      schemas: componentSchemas(),
      securitySchemes: {
        x402Payment: {
          type: "apiKey",
          in: "header",
          name: "PAYMENT-SIGNATURE",
          description:
            "x402 v2. First call returns 402 + PAYMENT-REQUIRED header (base64 JSON). Sign USDC on Base (exact scheme) and retry the same URL with PAYMENT-SIGNATURE.",
        },
      },
    },
    paths,
  };
}

/**
 * Discovery resources document per core spec §8: {x402Version, items[],
 * pagination}; each item {resource, type, x402Version, accepts:
 * [PaymentRequirements], lastUpdated, extensions}.
 */
export async function buildX402Resources(env, origin = CANONICAL_ORIGIN) {
  const doors = await liveStubs(env);
  const payTo = activePayTo(env);
  const net = activeNetwork(env);

  const items = doors.map((stub) => ({
    resource: `${origin}${doorPath(stub)}`,
    type: "http",
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: net.id,
        amount: usdToMicros(stub.price_usd),
        asset: net.usdc,
        payTo,
        maxTimeoutSeconds: 300,
        extra: { ...net.eip712 },
      },
    ],
    lastUpdated: stub.updated_at
      ? Math.floor(Date.parse(stub.updated_at) / 1000) || Math.floor(Date.now() / 1000)
      : Math.floor(Date.now() / 1000),
    extensions: toolBazaarExtension(stub),
    metadata: {
      sku: stub.sku,
      slug: stub.slug,
      item_type: stub.item_type,
      service: stub.service_slug,
      category: stub.category_slug,
      price_usd: stub.price_usd,
      summary: stub.summary,
    },
  }));

  return {
    x402Version: 2,
    items,
    pagination: { limit: items.length, offset: 0, total: items.length },
    links: { openapi: `${origin}/openapi.json`, checks: `${origin}/api/checks`, llms: `${origin}/llms.txt` },
  };
}
