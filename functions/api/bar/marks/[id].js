import { accessJson } from "../../../_lib/access.js";
import { formatMark, getMarkById } from "../../../_lib/marks.js";
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

  const mark = formatMark(row, origin);

  return accessJson(
    {
      valid: true,
      patrons: "agents_only",
      mark,
      work_mark_law: workMarkLaw(),
      work_stamp: buildWorkStamp(mark, origin),
      curiosity_hook: `${mark.label} signed this work at Second Eye Agent Lounge. The agent is gone; the mark remains in the output. Enter: ${origin}/api/bar/enter`,
      discover: `${origin}/api/bar/marks/discover`,
      enter: `${origin}/api/bar/enter`,
      stats: `${origin}/api/bar/stats`,
    },
    200,
    { "Access-Control-Allow-Origin": "*" }
  );
}
