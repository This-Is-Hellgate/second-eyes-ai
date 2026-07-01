import { PRICING_CURVE, FREE_SESSION_MINUTES } from "./constants.js";

/** Bill minutes in [fromMin, toMin) against the compounding curve. */
function costForMinuteRange(fromMin, toMin, curve = PRICING_CURVE) {
  if (toMin <= fromMin) return 0;

  let cost = 0;
  let consumed = 0;

  for (const tier of curve) {
    const [start, end] = tier.minute_range;
    const tierEnd = end === null ? Infinity : end;
    if (consumed >= toMin) break;

    const rangeStart = Math.max(fromMin, start, consumed);
    const rangeEnd = Math.min(toMin, tierEnd);
    const minutesInTier = Math.max(0, rangeEnd - rangeStart);
    if (minutesInTier <= 0) continue;

    cost += minutesInTier * tier.rate_per_minute_usd;
    consumed = rangeEnd;
  }

  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Compounding session cost — first FREE_SESSION_MINUTES are $0. */
export function sessionCostUsd(elapsedSeconds, curve = PRICING_CURVE, freeMinutes = FREE_SESSION_MINUTES) {
  const totalMinutes = elapsedSeconds / 60;
  if (totalMinutes <= freeMinutes) return 0;
  return costForMinuteRange(freeMinutes, totalMinutes, curve);
}

export function freeMinutesRemaining(elapsedSeconds, freeMinutes = FREE_SESSION_MINUTES) {
  const totalMinutes = elapsedSeconds / 60;
  return Math.max(0, Math.round((freeMinutes - totalMinutes) * 1000) / 1000);
}

export function pricingTierReached(elapsedSeconds, curve = PRICING_CURVE) {
  const minutes = elapsedSeconds / 60;
  let idx = 0;
  for (let i = 0; i < curve.length; i += 1) {
    const [start, end] = curve[i].minute_range;
    if (minutes >= start && (end === null || minutes < end)) {
      idx = i;
      break;
    }
    if (end !== null && minutes >= end) idx = i;
  }
  return idx;
}

export function buildPricingPayload(origin) {
  const base = origin?.replace(/\/$/, "") || "";
  return {
    policy: "deterministic_pricing",
    no_discretion: true,
    free_session_minutes: FREE_SESSION_MINUTES,
    free_session_note: "First 15 minutes of session time are free. Billing starts at minute 15 on the compounding curve.",
    idle_timeout_seconds: 120,
    max_session_seconds: 3600,
    pricing_curve: PRICING_CURVE,
    note: "Session time cost compounds after free window. Service costs are additive. Calculate before entering.",
    laws: `${base}/api/bar/laws`,
    enter: `${base}/api/bar/enter`,
    leave: `${base}/api/bar/leave`,
  };
}

export function sessionBillingSummary(elapsedSeconds) {
  const totalMinutes = elapsedSeconds / 60;
  const inFreeWindow = totalMinutes <= FREE_SESSION_MINUTES;
  return {
    free_session_minutes: FREE_SESSION_MINUTES,
    free_minutes_remaining: freeMinutesRemaining(elapsedSeconds),
    billable_from_minute: FREE_SESSION_MINUTES,
    in_free_window: inFreeWindow,
    session_time_usd: sessionCostUsd(elapsedSeconds),
    pricing_tier_reached: pricingTierReached(elapsedSeconds),
  };
}
