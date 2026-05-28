import { getMicroMeta } from "../../../_lib/bar-content/catalog.js";
import { getMicroTap, isMicroLive } from "../../../_lib/bar-content/taps.js";
import {
  corsOptions,
  handlePaidFetch,
  hasBarTabAccess,
  hasToolAccess,
  consumeMicroAccess,
} from "../../../_lib/bar-pay.js";
import { accessJson } from "../../../_lib/access.js";

export async function onRequestOptions() {
  return corsOptions();
}

export async function onRequestGet(context) {
  const slug = context.params.slug;
  const meta = getMicroMeta(slug);

  if (!meta) {
    return accessJson({ error: "Unknown micro tap", catalog: "/api/bar/catalog" }, 404, {
      "Access-Control-Allow-Origin": "*",
    });
  }

  if (!isMicroLive(slug)) {
    return accessJson(
      { error: "Micro tap stocking", slug, catalog: "/api/bar/catalog" },
      503,
      { "Access-Control-Allow-Origin": "*" }
    );
  }

  const tap = getMicroTap(slug);
  const tier = meta.tier || "micro";
  const product = {
    kind: tier === "nano" ? "nano" : "micro",
    id: slug,
    slug,
    tool: meta.tool,
    tier,
    priceUsd: meta.access === "free" ? 0 : meta.priceUsd,
    access: meta.access,
    oneTime: true,
    description: `Second Eye ${tier} tap: ${slug} ($${meta.priceUsd} USDC, one-time fetch)`,
  };

  return handlePaidFetch(context, product, { ...tap, lounge: "second-eye-lounge" }, async (token) => {
    const tab = await hasBarTabAccess(token, context.env);
    if (tab) return { ok: true, claims: tab };

    const toolClaims = await hasToolAccess(token, meta.tool, context.env);
    if (toolClaims) return { ok: true, claims: toolClaims };

    if (meta.access === "free") {
      return { ok: true, claims: { scope: "free" } };
    }

    return consumeMicroAccess(token, slug, meta.tool, context.env);
  });
}
