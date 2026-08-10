#!/usr/bin/env node

import {
  buildProductPaymentRequirements,
  buildFacilitatorRequestBody,
  buildFacilitatorWireBody,
} from "../../functions/_lib/x402.js";

const BASE = "eip155:8453";
const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const RESOURCE = "https://secondeyesai.com/api/bar/x402/help-me";
const MAX_DESCRIPTION = 500;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const product = {
  kind: "nano",
  id: "help-me",
  slug: "help-me",
  priceUsd: 0.01,
  access: "paid",
  description: "x".repeat(MAX_DESCRIPTION + 37),
};

const requirement = buildProductPaymentRequirements(product, RESOURCE, {
  X402_PAYTO: PAY_TO,
});

const signedPayload = {
  x402Version: 2,
  accepted: { network: BASE },
  payload: { signature: "0x" + "00".repeat(65) },
};

const built = buildFacilitatorRequestBody(
  Buffer.from(JSON.stringify(signedPayload)).toString("base64"),
  requirement
);
assert(built.ok, `builder failed: ${built.error}`);

// The parser/builder keeps the buyer payload intact. Resource attribution is added
// only to the facilitator wire body used by /verify and then reused by /settle.
assert(
  built.body.paymentPayload.resource === undefined,
  "builder should preserve an omitted buyer resource before facilitator enrichment"
);

const wireBody = buildFacilitatorWireBody(built.body, requirement);
assert(wireBody.paymentPayload.resource, "paymentPayload.resource must be present on facilitator wire body");
assert(
  wireBody.paymentPayload.resource.url === RESOURCE,
  `resource.url ${wireBody.paymentPayload.resource.url} != ${RESOURCE}`
);
assert(
  wireBody.paymentPayload.resource.mimeType === "application/json",
  "resource.mimeType must be application/json"
);
assert(
  Array.from(wireBody.paymentPayload.resource.description).length <= MAX_DESCRIPTION,
  `resource.description exceeds ${MAX_DESCRIPTION} characters`
);
assert(
  wireBody.paymentPayload.resource.description === Array.from(product.description).slice(0, MAX_DESCRIPTION).join(""),
  "resource.description must be the canonical server description capped at 500 characters"
);
assert(
  wireBody.paymentPayload.extensions === undefined,
  "wire enrichment must not inject Bazaar extensions into paymentPayload"
);
assert(
  !("resource" in wireBody.paymentRequirements),
  "paymentRequirements must remain the clean v2 per-accept shape"
);

// Buyer-supplied resource metadata must not redirect Bazaar attribution away from
// the canonical server requirement.
const spoofedPayload = {
  ...signedPayload,
  resource: {
    url: "https://attacker.invalid/not-second-eyes",
    description: "spoofed",
    mimeType: "text/plain",
  },
};
const spoofedBuilt = buildFacilitatorRequestBody(
  Buffer.from(JSON.stringify(spoofedPayload)).toString("base64"),
  requirement
);
assert(spoofedBuilt.ok, `spoofed builder failed: ${spoofedBuilt.error}`);
const spoofedWireBody = buildFacilitatorWireBody(spoofedBuilt.body, requirement);
assert(
  spoofedWireBody.paymentPayload.resource.url === RESOURCE,
  "Bazaar attribution must use the canonical requirement resource URL"
);
assert(
  spoofedWireBody.paymentPayload.resource.description === Array.from(product.description).slice(0, MAX_DESCRIPTION).join(""),
  "Bazaar attribution must use the canonical capped server description"
);

console.log("x402 Bazaar resource attribution regression test OK");
