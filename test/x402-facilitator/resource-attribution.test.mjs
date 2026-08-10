#!/usr/bin/env node

import {
  buildProductPaymentRequirements,
  buildFacilitatorRequestBody,
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
assert(built.body.paymentPayload.resource, "paymentPayload.resource must be present");
assert(
  built.body.paymentPayload.resource.url === RESOURCE,
  `resource.url ${built.body.paymentPayload.resource.url} != ${RESOURCE}`
);
assert(
  built.body.paymentPayload.resource.mimeType === "application/json",
  "resource.mimeType must be application/json"
);
assert(
  built.body.paymentPayload.resource.description.length <= MAX_DESCRIPTION,
  `resource.description exceeds ${MAX_DESCRIPTION} characters`
);
assert(
  built.body.paymentPayload.resource.description === product.description.slice(0, MAX_DESCRIPTION),
  "resource.description must be the canonical server description capped at 500 characters"
);
assert(
  built.body.paymentPayload.extensions === undefined,
  "builder must not inject Bazaar extensions into paymentPayload"
);
assert(
  !("resource" in built.body.paymentRequirements),
  "paymentRequirements must remain the clean v2 per-accept shape"
);

// Buyer-supplied resource metadata must not be able to redirect Bazaar attribution
// away from the canonical server requirement.
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
assert(
  spoofedBuilt.body.paymentPayload.resource.url === RESOURCE,
  "Bazaar attribution must use the canonical requirement resource URL"
);
assert(
  spoofedBuilt.body.paymentPayload.resource.description === product.description.slice(0, MAX_DESCRIPTION),
  "Bazaar attribution must use the canonical capped server description"
);

console.log("x402 Bazaar resource attribution regression test OK");
