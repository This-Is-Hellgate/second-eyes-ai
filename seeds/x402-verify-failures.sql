-- Recoverable x402 verify/settle failure detail — one row per FAILED attempt,
-- keyed by the Cloudflare request id (cf-ray) so a failure can be diagnosed
-- without Cloudflare dashboard historical logs (which are not persisted).
--
-- Additive: independent of x402_payment_attempts. The runtime bootstrap in
-- functions/_lib/x402-payment-log.js (ensureX402VerifyFailureTable) is
-- CREATE TABLE IF NOT EXISTS only and self-heals on first use, so applying this
-- file remotely is optional. facilitator_body is the REDACTED CDP /verify body
-- (signatures/authorizations stripped by redactFacilitatorBody) — never raw.

CREATE TABLE IF NOT EXISTS x402_verify_failures (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  created_at TEXT NOT NULL,
  route TEXT,
  stage TEXT,
  declared_network TEXT,
  selected_network TEXT,
  facilitator_status INTEGER,
  invalid_reason TEXT,
  facilitator_body TEXT,
  x402_version INTEGER
);

CREATE INDEX IF NOT EXISTS idx_x402_verify_failures_request ON x402_verify_failures(request_id);
CREATE INDEX IF NOT EXISTS idx_x402_verify_failures_created ON x402_verify_failures(created_at);
CREATE INDEX IF NOT EXISTS idx_x402_verify_failures_stage ON x402_verify_failures(stage);
