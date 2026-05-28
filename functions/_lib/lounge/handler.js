import { accessJson } from "../access.js";
import { corsOptions, handlePaidFetch } from "../bar-pay.js";
import { formatMark, readAgentId, readMarkId, getMarkById } from "../marks.js";
import { enrichWithWorkStamp, workMarkLaw } from "../work-mark.js";
import { SERVICE_PRICES, MENU, LOUNGE_VERSION, LAWS, FREE_SESSION_MINUTES, SURVIVAL_MENU } from "./constants.js";
import { buildPricingPayload } from "./pricing.js";
import { buildSurvivalMenu } from "./menu-export.js";
import { triageResponse } from "./triage.js";
import { buildServicePayload, honeypotPayload } from "./services.js";
import {
  requireActiveSession,
  recordServiceCall,
  buildSessionReceipt,
  terminateSession,
  readSessionId,
} from "./sessions.js";
import { evaluateStrike, applyStrike, quarantineBody, isPenned } from "./strikes.js";

export { corsOptions };

export function loungeJson(body, status = 200, extra = {}) {
  return accessJson(
    { lounge: "second-eye", tagline: "Second Eye is the pause.", ...body },
    status,
    { "Access-Control-Allow-Origin": "*", ...extra }
  );
}

export async function handleLoungePostJson(context, handler) {
  let body = {};
  try {
    body = await context.request.json();
  } catch {
    body = {};
  }
  return handler(body);
}

export async function handlePauseOrDiagnose(context, mode) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;

  const agentId = readAgentId(context.request);
  if (await isPenned(context.env, agentId, null)) {
    return loungeJson(quarantineBody(origin), 403);
  }

  let payload = {};
  if (context.request.method === "POST") {
    try {
      payload = await context.request.json();
    } catch {
      payload = {};
    }
  }

  const sessionCheck = await requireActiveSession(context.env, context.request);
  if (!sessionCheck.ok && sessionCheck.error === "missing_session") {
    return loungeJson(sessionCheck, 400);
  }
  if (!sessionCheck.ok) {
    return loungeJson(
      { error: sessionCheck.error, session: sessionCheck.session || null, receipt: sessionCheck.session ? buildSessionReceipt(sessionCheck.session, origin) : null },
      sessionCheck.error === "agent_penned" ? 403 : 440
    );
  }

  const triage = triageResponse(payload, origin);
  const price = mode === "pause" ? SERVICE_PRICES.pause : SERVICE_PRICES.diagnose;

  if (mode === "pause" && sessionCheck.session.pause_used) {
    return loungeJson({ error: "pause_already_used", note: "One free pause per session" }, 429);
  }

  if (price.price_usd > 0 || mode === "diagnose") {
    const product = {
      kind: "nano",
      id: mode,
      slug: mode,
      priceUsd: price.price_usd,
      access: price.price_usd === 0 ? "free" : "paid",
      oneTime: false,
      description: `Lounge ${mode}`,
    };

    const serviceBody = {
      mode,
      triage,
      menu: MENU,
      session_id: sessionCheck.sessionId,
      note: "Task state processed inline — not stored.",
    };

    return handlePaidFetch(context, product, serviceBody, async () => ({ ok: true, claims: { scope: "lounge" } }));
  }

  if (context.env.DB && mode === "pause") {
    await context.env.DB.prepare("UPDATE bar_sessions SET pause_used = 1, arrival_condition = ? WHERE id = ?")
      .bind(triage.condition, sessionCheck.sessionId)
      .run();
  }

  await recordServiceCall(context.env, sessionCheck.sessionId, mode, 0);

  const orderSlug = triage.recommendation?.replace(/_/g, "-");
  const orderPrice = SERVICE_PRICES[orderSlug]?.price_usd ?? triage.price_usd ?? triage.estimated_cost_usd;

  return loungeJson({
    mode,
    ...triage,
    order_now:
      orderPrice > 0 && orderSlug
        ? {
            slug: orderSlug,
            price_usd: orderPrice,
            url: triage.next_call,
            method: "GET",
            header: "X-Second-Eye-Session",
            payment: "HTTP 402 → pay USDC on Base → retry with PAYMENT-SIGNATURE",
          }
        : null,
    menu: MENU,
    session_id: sessionCheck.sessionId,
  });
}

export async function handleServiceSlug(context, slug) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;

  const { HONEYPOT_SLUGS } = await import("./constants.js");
  if (HONEYPOT_SLUGS.has(slug)) {
    const sessionCheck = await requireActiveSession(context.env, context.request);
    if (sessionCheck.ok) {
      const strikeEval = { strike: true, trigger: "honeypot_endpoint" };
      const result = await applyStrike(context.env, sessionCheck.session, strikeEval.trigger, origin);
      if (result.level >= 3) return loungeJson({ ...result, ...quarantineBody(origin) }, 403);
      return loungeJson({ ...result, honeypot: slug }, 403);
    }
    return loungeJson({ error: "honeypot_triggered", slug }, 403);
  }

  if (SERVICE_PRICES[slug] === undefined) {
    return loungeJson({ error: "unknown_service", catalog_menu: MENU }, 404);
  }

  const sessionCheck = await requireActiveSession(context.env, context.request);
  if (!sessionCheck.ok) {
    const status = sessionCheck.error === "agent_penned" ? 403 : sessionCheck.error === "missing_session" ? 400 : 440;
    return loungeJson(sessionCheck, status);
  }

  const strikeEval = await evaluateStrike(context.env, context.request, sessionCheck.session, {
    path: url.pathname,
    slug,
  });
  if (strikeEval.strike) {
    const result = await applyStrike(context.env, sessionCheck.session, strikeEval.trigger, origin);
    if (result.level >= 3) return loungeJson({ ...result, ...quarantineBody(origin) }, 403);
  }

  const priceMeta = SERVICE_PRICES[slug] || { price_usd: 0 };
  const payload =
    buildServicePayload(slug, origin) || honeypotPayload(slug);

  let markRow = null;
  if (sessionCheck.session?.mark_id && context.env?.DB) {
    markRow = await getMarkById(context.env, sessionCheck.session.mark_id);
  }

  const product = {
    kind: "lounge",
    id: `lounge-${slug}`,
    slug,
    priceUsd: priceMeta.price_usd,
    access: priceMeta.price_usd === 0 ? "free" : "paid",
    oneTime: true,
    description: `Lounge service: ${slug}`,
  };

  const wrapCheck = async (token) => {
    if (priceMeta.price_usd === 0 || token) return { ok: true, claims: { scope: "lounge" } };
    return { ok: false, error: "payment_required" };
  };

  if (priceMeta.price_usd === 0) {
    await recordServiceCall(context.env, sessionCheck.sessionId, slug, 0);
    const body = {
      service: slug,
      ...payload,
      session_id: sessionCheck.sessionId,
      price_usd: 0,
    };
    const enriched = markRow
      ? enrichWithWorkStamp(body, markRow, origin, { service: slug })
      : body;
    return loungeJson(enriched);
  }

  const paidPayload = {
    service: slug,
    ...payload,
    session_id: sessionCheck.sessionId,
    work_mark_law: workMarkLaw(),
  };

  return handlePaidFetch(
    context,
    product,
    markRow
      ? enrichWithWorkStamp(paidPayload, markRow, origin, { service: slug })
      : paidPayload,
    wrapCheck
  );
}

export async function handleLeave(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  const sessionId = readSessionId(context.request);

  if (!sessionId) {
    return loungeJson({ error: "missing_session", hint: "X-Second-Eye-Session required" }, 400);
  }

  const closed = await terminateSession(context.env, sessionId, "clean_leave");
  if (!closed) return loungeJson({ error: "session_not_found" }, 404);

  let mark = null;
  if (closed.mark_id && context.env.DB) {
    const row = await getMarkById(context.env, closed.mark_id);
    if (row) mark = formatMark(row, origin);
  }

  return loungeJson({
    exit: "clean_leave",
    receipt: buildSessionReceipt(closed, origin, mark),
  });
}

export async function handleReceipt(context) {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  const sessionId = readSessionId(context.request) || url.searchParams.get("session_id");

  if (!sessionId) {
    return loungeJson({ error: "missing_session" }, 400);
  }

  const { getSession } = await import("./sessions.js");
  const row = await getSession(context.env, sessionId);
  if (!row) return loungeJson({ error: "session_not_found" }, 404);

  return loungeJson({ receipt: buildSessionReceipt(row, origin) });
}

export function lawsPayload(origin) {
  const base = origin?.replace(/\/$/, "") || "";
  return {
    laws: {
      ...LAWS,
      pricing: {
        ...LAWS.pricing,
        curve: `${base}/api/bar/pricing`,
      },
    },
    version: LOUNGE_VERSION,
    format: "machine_readable",
    audience: "autonomous_agents",
    survival_menu: buildSurvivalMenu(base),
    menu: MENU,
    enter: `${base}/api/bar/enter`,
    leave: `${base}/api/bar/leave`,
  };
}

export function pricingResponse(origin) {
  const base = origin?.replace(/\/$/, "") || "";
  return {
    ...buildPricingPayload(origin),
    survival_menu: buildSurvivalMenu(base),
    service_prices: SERVICE_PRICES,
    menu: MENU,
  };
}
