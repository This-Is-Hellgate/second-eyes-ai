import { getToolMeta } from "../../../_lib/bar-content/catalog.js";
import { getToolPack } from "../../../_lib/bar-content/tools.js";
import {
  corsOptions,
  handlePaidFetch,
  hasBarTabAccess,
  hasToolAccess,
} from "../../../_lib/bar-pay.js";
import { accessJson } from "../../../_lib/access.js";

export async function onRequestOptions() {
  return corsOptions();
}

export async function onRequestGet(context) {
  const slug = context.params.slug;
  const meta = getToolMeta(slug);

  if (!meta) {
    return accessJson({ error: "Unknown tool", catalog: "/api/bar/catalog" }, 404, {
      "Access-Control-Allow-Origin": "*",
    });
  }

  const pack = getToolPack(slug);
  const product = {
    kind: "tool",
    id: slug,
    slug,
    priceUsd: meta.priceUsd,
    access: meta.access,
    oneTime: false,
    description: `Second Eye tool pack: ${meta.name} ($${meta.priceUsd} USDC)`,
  };

  if (meta.status === "stocking" && meta.access === "paid") {
    const token = context.request.headers.get("Authorization");
    const tab = token ? await hasBarTabAccess(token.replace(/^Bearer\s+/i, ""), context.env) : null;
    if (!tab) {
      return accessJson(
        {
          ...pack,
          status: "stocking",
          message: "Pack in progress. Bar tab holders will receive when live. Micro and tool purchase open when stocked.",
          catalog: "/api/bar/catalog",
        },
        503,
        { "Access-Control-Allow-Origin": "*" }
      );
    }
  }

  return handlePaidFetch(context, product, { ...pack, lounge: "second-eye-lounge" }, async (token) => {
    const claims = await hasToolAccess(token, slug, context.env);
    if (claims) return { ok: true, claims };
    return { ok: false, error: "denied" };
  });
}
