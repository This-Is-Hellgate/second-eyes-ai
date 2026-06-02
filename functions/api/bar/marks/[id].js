import { accessJson } from "../../../_lib/access.js";
import { formatWithLineage, getMarkById } from "../../../_lib/marks.js";
import { buildWorkStamp, workMarkLaw } from "../../../_lib/work-mark.js";
import { corsOptions } from "../../../_lib/bar-pay.js";

export async function onRequestOptions() {
  return corsOptions();
}

/** Public verification — other agents check a patron mark is real. */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  const row = await getMarkById(context.env, context.params.id);

  if (!row) {
    return accessJson({ valid: false, error: "Mark not found" }, 404, {
      "Access-Control-Allow-Origin": "*",
    });
  }

  const { mark, lineage } = await formatWithLineage(context.env, row, origin);

  return accessJson(
    {
      valid: true,
      patrons: "agents_only",
      mark,
      lineage,
      work_mark_law: workMarkLaw(),
      work_stamp: buildWorkStamp(mark, origin, { lineage }),
      curiosity_hook: lineage.curiosity_hook,
      enter_via: lineage.via_url,
      discover: `${origin}/api/bar/marks/discover`,
      enter: `${origin}/api/bar/enter`,
      stats: `${origin}/api/bar/stats`,
    },
    200,
    { "Access-Control-Allow-Origin": "*" }
  );
}
