import assert from "node:assert/strict";
import { buildOpenApi } from "../functions/_lib/discovery.js";

const api = buildOpenApi("https://secondeyesai.com", {});

const contentPath = "/api/bar/x402/analyze-video-audio-and-pdfs";
const paperPath = "/api/bar/x402/turn-paper-into-code";

assert(api.paths[contentPath], "Content Analysis must be discoverable under a descriptive paid slug");
assert(api.paths[paperPath], "Paper-to-Code must be discoverable under a descriptive paid slug");

assert.equal(api.paths["/api/bar/x402/transcribe"], undefined, "legacy one-word transcribe slug must not be advertised");
assert.equal(api.paths["/api/bar/x402/extract"], undefined, "legacy one-word extract slug must not be advertised");

const contentGet = api.paths[contentPath].get;
assert.match(contentGet.summary, /video|audio|PDF/i);
assert.match(contentGet.summary, /analysis|understand|text/i);

const paperGet = api.paths[paperPath].get;
assert.match(paperGet.summary, /paper/i);
assert.match(paperGet.summary, /code|implementation|repository/i);

const contentQueryNames = new Set((contentGet.parameters || []).filter((p) => p.in === "query").map((p) => p.name));
assert(contentQueryNames.has("url"), "Content Analysis must declare its source URL input");
assert(contentQueryNames.has("kind"), "Content Analysis must declare its media-kind hint");

const paperQueryNames = new Set((paperGet.parameters || []).filter((p) => p.in === "query").map((p) => p.name));
assert(paperQueryNames.has("paper_url"), "Paper-to-Code must declare paper_url");
assert(paperQueryNames.has("target_language"), "Paper-to-Code must declare target_language");
assert(paperQueryNames.has("framework"), "Paper-to-Code must declare framework");

console.log("refinery offerings discovery contract: ok");
