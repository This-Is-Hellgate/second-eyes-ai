import { authorize, handleOptions } from "../../../_lib/auth.js";
import { json } from "../../../_lib/review.js";
import { lookupX402VerifyFailure } from "../../../_lib/x402-payment-log.js";

export async function onRequestOptions() {
  return handleOptions();
}

/**
 * Operator diagnostic — look up persisted x402 verify/settle failure detail by
 * the Cloudflare request id (cf-ray), so a failure is recoverable without the
 * Cloudflare dashboard historical logs.
 *
 * Auth: REVIEW_TOKEN (Bearer header or ?token=). The stored facilitator_body is
 * already redacted (signatures/authorizations stripped), but the diagnostic
 * fields are operator-only, so the route is gated.
 *
 *   GET /api/bar/proof/verify-failure?requestId=<cf-ray>&token=<REVIEW_TOKEN>
 *   GET /api/bar/proof/verify-failure?requestId=<cf-ray>   (Authorization: Bearer <REVIEW_TOKEN>)
 */
export async function onRequestGet(context) {
  const { request, env } = context;

  const auth = authorize(request, env);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const requestId =
    url.searchParams.get("requestId") || url.searchParams.get("request_id") || "";
  if (!requestId.trim()) {
    return json(
      { error: "missing_request_id", note: "Pass ?requestId=<cf-ray>" },
      400
    );
  }

  const result = await lookupX402VerifyFailure(env, requestId, {
    limit: Number.parseInt(url.searchParams.get("limit") || "20", 10),
  });

  if (!result.ok) {
    const status = result.reason === "no_db_binding" ? 503 : 400;
    return json({ probe: "verify_failure", pass: false, reason: result.reason }, status);
  }

  return json(
    {
      probe: "verify_failure",
      pass: result.count > 0,
      request_id: result.request_id,
      count: result.count,
      failures: result.failures,
      note:
        result.count === 0
          ? "No persisted verify failure for that request id. It may predate this logging, or the id is not a cf-ray."
          : undefined,
    },
    200
  );
}
