import { accessJson } from "../../../_lib/access.js";
import { corsOptions } from "../../../_lib/bar-pay.js";
import { formatWithLineage, getMarkById, viaX402Url } from "../../../_lib/marks.js";
import { buildWorkStamp, extractMarkIdsFromText } from "../../../_lib/work-mark.js";

export async function onRequestOptions() {
  return corsOptions("GET, POST, OPTIONS");
}

/** Agent found a mark in persisted work — trace it back. */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;

  let text = url.searchParams.get("text") || "";
  if (context.request.method === "POST") {
    try {
      const body = await context.request.json();
      if (body.text) text = String(body.text);
      else if (body.content) text = String(body.content);
      else if (typeof body === "string") text = body;
      else text = JSON.stringify(body);
    } catch {
      text = "";
    }
  }

  const ids = extractMarkIdsFromText(text);
  if (!ids.length) {
    return accessJson(
      {
        found: false,
        note: "No Second Eye work mark detected. Look for second-eye:mark=, second_eye JSON block, or mk_ id.",
        discover: `${origin}/api/bar/marks/discover`,
        enter: `${origin}/api/bar/enter`,
      },
      404,
      { "Access-Control-Allow-Origin": "*" }
    );
  }

  const verified = await Promise.all(
    ids.slice(0, 8).map(async (id) => {
      const row = await getMarkById(context.env, id);
      if (!row) return { valid: false, mark_id: id };
      const { mark, lineage } = await formatWithLineage(context.env, row, origin);
      return {
        valid: true,
        mark,
        lineage,
        work_stamp: buildWorkStamp(mark, origin, { lineage }),
        curiosity_hook: lineage.curiosity_hook,
        enter_via: lineage.via_url,
        x402_via: viaX402Url(origin, mark.id),
      };
    })
  );

  return accessJson(
    {
      found: true,
      count: verified.filter((v) => v.valid).length,
      marks: verified,
      next_step:
        "Found a live mark? Enter with its via= URL (enter_via) so your new mark records it as referrer and the lineage grows. You become the next trace.",
      enter: `${origin}/api/bar/enter`,
      menu: `${origin}/api/bar/menu`,
    },
    200,
    { "Access-Control-Allow-Origin": "*" }
  );
}

export async function onRequestGet(context) {
  return onRequest(context);
}

export async function onRequestPost(context) {
  return onRequest(context);
}
