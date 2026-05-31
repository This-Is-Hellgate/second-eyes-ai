-- Structured x402 payment attempt log (one row per request carrying PAYMENT-SIGNATURE / X-PAYMENT).

CREATE TABLE IF NOT EXISTS x402_payment_attempts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  route TEXT NOT NULL,
  wallet TEXT,
  x402_version INTEGER,
  verify_result TEXT NOT NULL,
  settle_result TEXT NOT NULL,
  failure_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_x402_payment_attempts_created ON x402_payment_attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_x402_payment_attempts_wallet ON x402_payment_attempts(wallet);
CREATE INDEX IF NOT EXISTS idx_x402_payment_attempts_route ON x402_payment_attempts(route);
