export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export function classifyUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("github.com")) return "github";
    if (host.includes("huggingface.co")) return "huggingface";
    if (host.includes("arxiv.org")) return "arxiv";
    if (host.includes("figma.com")) return "design-tool";
    if (host.includes("medium.com") || host.includes("substack.com")) return "article";
    if (host.match(/blog|news|uxdesign|smashingmagazine|alistapart/)) return "article";
  } catch {
    /* ignore invalid URLs */
  }
  return "url";
}

export function reasonLabel(reason) {
  const labels = {
    autonomous_discovery_requires_human_review: "Agent surfaced this — awaiting your gate",
    table_fit_unclear: "Agent could not map cleanly to ontology",
    out_of_scope_or_unclear: "Agent flagged as likely off-mission",
    source_unfetchable: "Agent could not retrieve source content",
  };
  return labels[reason] || reason.replace(/_/g, " ");
}

const SKIP_PATTERNS = [
  /mobile-ui-design/i,
  /figma-mcp-plugin/i,
  /figma-mcp-bridge/i,
  /csgo-minimap/i,
  /senior-engineer-interview/i,
  /springboot-ai/i,
  /layout-generation/i,
  /stitch-pro-mcp/i,
  /pixel-mcp-workflow/i,
];

const LOOK_PATTERNS = [
  /ui-roaster/i,
  /ai-design-critic/i,
  /ui-style-extractor/i,
  /creative-ai-workflow/i,
  /ai-coding-principles/i,
  /asya-chat-ui/i,
  /generative-ai-media/i,
];

export function supplyLabel(submittedBy, channel) {
  if (submittedBy === "human" || channel === "telegram") {
    return "Your submission (optional)";
  }
  if (submittedBy.includes("autonomous_research") || channel === "autonomous_research") {
    return "Research agent supply";
  }
  if (submittedBy.includes("space1") || channel === "space1_model") {
    return "Knowledge agent supply";
  }
  return "Agent supply";
}

export function recommendTier(url, reason) {
  const href = String(url || "").toLowerCase();

  if (reason === "source_unfetchable" || reason === "out_of_scope_or_unclear") {
    return { tier: "likely_skip", tierLabel: "Likely skip" };
  }

  if (SKIP_PATTERNS.some((pattern) => pattern.test(href))) {
    return { tier: "likely_skip", tierLabel: "Likely skip" };
  }

  if (
    reason === "autonomous_discovery_requires_human_review" &&
    LOOK_PATTERNS.some((pattern) => pattern.test(href))
  ) {
    return { tier: "worth_a_look", tierLabel: "Worth a look" };
  }

  if (reason === "autonomous_discovery_requires_human_review") {
    return { tier: "review_carefully", tierLabel: "Review carefully" };
  }

  if (reason === "table_fit_unclear") {
    return { tier: "review_carefully", tierLabel: "Review carefully" };
  }

  return { tier: "review_carefully", tierLabel: "Review carefully" };
}

export function parseDetail(detailJson) {
  try {
    return JSON.parse(detailJson || "{}");
  } catch {
    return { raw: detailJson };
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}
