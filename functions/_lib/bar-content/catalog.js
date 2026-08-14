import {
  BAR,
  TOOLS,
  MICRO_TAPS,
  BARS as BASE_BARS,
  getToolMeta,
  getMicroMeta,
  buildCatalogPayload as buildBaseCatalogPayload,
} from "./catalog-base.js";

export { BAR, TOOLS, MICRO_TAPS, getToolMeta, getMicroMeta };

const replacements = [
  {
    slug: "analyze-video-audio-and-pdfs",
    name: "Content Analysis",
    kind: "tap",
    dynamic: true,
    media: true,
    session_required: false,
    priceUsd: 0.05,
    method: "GET|POST",
    path: "/api/bar/x402/analyze-video-audio-and-pdfs",
    lead: "Analyze public video, audio, podcasts, PDFs, and documents for text-only agents. Returns abstractive summary, semantic extraction, thematic distillation, epistemic mapping, grounded Q&A, and an agent briefing without returning a verbatim transcript.",
  },
  {
    slug: "turn-paper-into-code",
    name: "Turn Paper Into Code",
    kind: "tap",
    dynamic: true,
    media: true,
    session_required: false,
    priceUsd: 0.05,
    method: "GET|POST",
    path: "/api/bar/x402/turn-paper-into-code",
    lead: "Give us a research-paper PDF and get back an implementation package with architecture, algorithms, dependencies, source files, tests, commands, assumptions, and fidelity boundaries.",
  },
];

function replaceServices(services) {
  const kept = services.filter((service) => !["transcribe-extract", "doc-extract"].includes(service.slug));
  return [...kept, ...replacements];
}

export const BARS = BASE_BARS.map((bar) =>
  bar.slug === "x402" ? { ...bar, services: replaceServices(bar.services) } : bar
);

export function getBar(slug) {
  return BARS.find((bar) => bar.slug === slug) || null;
}

export function buildCatalogPayload(baseUrl) {
  const origin = baseUrl.replace(/\/$/, "");
  const payload = buildBaseCatalogPayload(baseUrl);
  payload.bars = BARS.map((bar) => ({
    ...bar,
    services: bar.services.map((service) => ({
      ...service,
      fetch: service.path.startsWith("http") ? service.path : `${origin}${service.path}`,
    })),
  }));
  return payload;
}
