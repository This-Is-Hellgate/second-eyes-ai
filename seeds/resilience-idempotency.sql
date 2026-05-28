-- Payment idempotency — prevent double-grant on x402/Stripe retries

CREATE UNIQUE INDEX IF NOT EXISTS idx_access_grants_tx_ref
  ON access_grants(tx_ref)
  WHERE tx_ref IS NOT NULL AND tx_ref != '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_access_grants_stripe_session
  ON access_grants(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL AND stripe_session_id != '';

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  product_kind TEXT,
  product_slug TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);
