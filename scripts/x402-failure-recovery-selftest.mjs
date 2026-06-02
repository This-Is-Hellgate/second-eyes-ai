#!/usr/bin/env node
/**
 * No-spend proof that x402 verify failures are RECOVERABLE from D1 alone — the
 * gap that made request req_ebefc6f9596f2313 unrecoverable when the Cloudflare
 * Pages Functions logs were not persisted.
 *
 * Covers:
 *   - readRequestId() prefers the cf-ray header (the recoverable request id) and
 *     falls back to a generated id when no request/ray is present.
 *   - buildVerifyFailureRow() flattens a verify result into a secret-free row and
 *     serializes ONLY the already-redacted facilitator body (no signatures).
 *   - recordX402VerifyFailure() + lookupX402VerifyFailure() round-trip through a
 *     D1 stub: a failure persisted under a request id is retrievable by that id,
 *     and the stored body carries no signature/authorization material.
 *
 * Pure — no network, no money, Node built-ins + repo modules + an in-memory D1
 * stub only. Exit 1 on any failure. Mirrors scripts/x402-multinetwork-selftest.mjs.
 */

import { redactFacilitatorBody } from "../functions/_lib/x402.js";
import {
  readRequestId,
  buildVerifyFailureRow,
  recordX402VerifyFailure,
  lookupX402VerifyFailure,
} from "../functions/_lib/x402-payment-log.js";

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
const eq = (where, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(where, `got ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  }
};

/**
 * Minimal in-memory D1 stub. Supports the exact prepared-statement shapes the
 * payment-log module uses: batch() of CREATE statements, INSERT via bind().run(),
 * and the SELECT ... WHERE request_id = ? ... bind().all().
 */
function makeD1Stub() {
  const rows = [];
  const prepare = (sql) => {
    const stmt = {
      sql,
      _args: [],
      bind(...args) {
        this._args = args;
        return this;
      },
      async run() {
        if (/^INSERT INTO x402_verify_failures/i.test(sql.trim())) {
          const [
            id,
            request_id,
            created_at,
            route,
            stage,
            declared_network,
            selected_network,
            facilitator_status,
            invalid_reason,
            facilitator_body,
            x402_version,
          ] = this._args;
          rows.push({
            id,
            request_id,
            created_at,
            route,
            stage,
            declared_network,
            selected_network,
            facilitator_status,
            invalid_reason,
            facilitator_body,
            x402_version,
          });
        }
        return { success: true };
      },
      async all() {
        if (/FROM x402_verify_failures/i.test(sql)) {
          const [reqId] = this._args;
          const matched = rows
            .filter((r) => r.request_id === reqId)
            .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
          return { results: matched };
        }
        return { results: [] };
      },
      async first() {
        return null;
      },
    };
    return stmt;
  };
  return {
    DB: {
      prepare,
      async batch(stmts) {
        for (const s of stmts) await s.run();
        return [];
      },
    },
    _rows: rows,
  };
}

// --- 1. readRequestId prefers cf-ray ------------------------------------------
{
  const req = { headers: { get: (k) => (k === "cf-ray" ? "8f1aRAY-IAD" : null) } };
  eq("readRequestId cf-ray", readRequestId(req), "8f1aRAY-IAD");

  const noRay = { headers: { get: () => null } };
  const gen = readRequestId(noRay);
  if (!gen || !gen.startsWith("req_")) fail("readRequestId", `fallback not a req_ id: ${gen}`);

  const none = readRequestId(undefined);
  if (!none || !none.startsWith("req_")) fail("readRequestId", `undefined req fallback bad: ${none}`);
}

// --- 2. buildVerifyFailureRow flattens + carries only redacted body -----------
{
  const verifyResult = {
    ok: false,
    error: "Payment verification failed",
    stage: "verify",
    network: "eip155:8453",
    invalidReason: "insufficient_funds",
    facilitatorStatus: 402,
    // Already redacted by redactFacilitatorBody at the call site.
    facilitatorResponse: redactFacilitatorBody({
      isValid: false,
      invalidReason: "insufficient_funds",
      payer: "0xPayer",
      signature: "0x2d6a7588deadbeefdeadbeefdeadbeefdeadbeef",
      authorization: { from: "0xa", value: "10000", nonce: "0xdead" },
    }),
  };
  const row = buildVerifyFailureRow(verifyResult, {
    requestId: "req_ebefc6f9596f2313",
    route: "/api/access/purchase",
    x402_version: 2,
  });
  eq("row request_id", row.request_id, "req_ebefc6f9596f2313");
  eq("row route", row.route, "/api/access/purchase");
  eq("row stage", row.stage, "verify");
  eq("row selected_network", row.selected_network, "eip155:8453");
  eq("row facilitator_status", row.facilitator_status, 402);
  eq("row invalid_reason", row.invalid_reason, "insufficient_funds");
  if (row.facilitator_body.includes("2d6a7588") || row.facilitator_body.includes("0xdead")) {
    fail("row", "secret material leaked into persisted facilitator_body");
  }
  if (!row.facilitator_body.includes("insufficient_funds")) {
    fail("row", "diagnostic invalidReason missing from persisted body");
  }

  // Successful results persist nothing.
  eq("row ok→null", buildVerifyFailureRow({ ok: true }, {}), null);
  eq("row null→null", buildVerifyFailureRow(null, {}), null);
}

// --- 3. buildVerifyFailureRow captures the multi-rail hard-reject -------------
{
  const selectFail = {
    ok: false,
    error: "unsupported_payment_network",
    stage: "select",
    invalidReason: "unsupported_payment_network",
    declaredNetwork: "eip155:137",
  };
  const row = buildVerifyFailureRow(selectFail, { requestId: "ray-x", route: "/r" });
  eq("select stage", row.stage, "select");
  eq("select declared_network", row.declared_network, "eip155:137");
  eq("select facilitator_body", row.facilitator_body, null);
}

// --- 4. record → lookup round-trips through the D1 stub ------------------------
{
  const env = makeD1Stub();
  const result = {
    ok: false,
    stage: "verify",
    network: "eip155:8453",
    invalidReason: "insufficient_funds",
    facilitatorStatus: 402,
    facilitatorResponse: redactFacilitatorBody({
      invalidReason: "insufficient_funds",
      signature: "0xSECRETSIGdeadbeef",
    }),
  };
  await recordX402VerifyFailure(env, result, {
    requestId: "req_ebefc6f9596f2313",
    route: "/api/access/purchase",
    x402_version: 2,
  });

  const found = await lookupX402VerifyFailure(env, "req_ebefc6f9596f2313");
  if (!found.ok) fail("lookup", `not ok: ${found.reason}`);
  eq("lookup count", found.count, 1);
  const hit = found.failures[0];
  eq("lookup stage", hit.stage, "verify");
  eq("lookup invalid_reason", hit.invalid_reason, "insufficient_funds");
  eq("lookup facilitator_status", hit.facilitator_status, 402);
  // facilitator_body is re-parsed to an object on lookup and must be secret-free.
  if (JSON.stringify(hit.facilitator_body).includes("SECRETSIG")) {
    fail("lookup", "signature leaked through persistence + lookup");
  }

  // Unknown id → empty, still ok.
  const miss = await lookupX402VerifyFailure(env, "req_does_not_exist");
  eq("lookup miss ok", miss.ok, true);
  eq("lookup miss count", miss.count, 0);
}

// --- 5. lookup guards bad inputs ----------------------------------------------
{
  const env = makeD1Stub();
  const noId = await lookupX402VerifyFailure(env, "");
  eq("lookup empty id", noId.ok, false);
  eq("lookup empty reason", noId.reason, "missing_request_id");

  const noDb = await lookupX402VerifyFailure({}, "ray");
  eq("lookup no db", noDb.ok, false);
  eq("lookup no db reason", noDb.reason, "no_db_binding");
}

if (failures.length) {
  console.error("x402 failure-recovery self-test FAILED:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n${failures.length} issue(s).`);
  process.exit(1);
}

console.log(
  "x402 failure-recovery self-test OK — verify failures persist redacted detail keyed by cf-ray and are recoverable from D1 alone (no signatures leak)."
);
