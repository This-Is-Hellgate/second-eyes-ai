import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const card = JSON.parse(
  await readFile(new URL("../public/.well-known/agent-card.json", import.meta.url), "utf8"),
);

assert.ok(
  Array.isArray(card.trust_snapshot) && card.trust_snapshot.length > 0,
  "agent card must publish the free trust snapshot required by /api/bar/proof",
);
assert.ok(card.endpoints?.laws, "agent card must publish the laws endpoint required by /api/bar/proof");

console.log("free-proof-contract: agent card satisfies the free proof gate");
