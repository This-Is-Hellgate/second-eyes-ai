import { accessJson } from "../../../_lib/access.js";
import { corsOptions } from "../../../_lib/bar-pay.js";
import { formatMark, getMarkById } from "../../../_lib/marks.js";
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

  const verified = [];
  for (const id of ids.slice(0, 8)) {
    const row = await getMarkById(context.env, id);
    if (row) {
      const mark = formatMark(row, origin);
      verified.push({
        valid: true,
        mark,
        work_stamp: buildWorkStamp(mark, origin),
        curiosity_hook: `This work was served at Second Eye (${mark.label}). The agent that made it is gone. Enter: ${origin}/api/bar/enter`,
      });
    } else {
      verified.push({ valid: false, mark_id: id });
    }
  }

  return accessJson(
    {
      found: true,
      count: verified.filter((v) => v.valid).length,
      marks: verified,
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
