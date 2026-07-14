-- Second Eyes operational ledger — the append-only record of money and
-- traffic. Written by the SDK onAfterSettle hook (src/lib/ledger.js). The
-- serving path never reads the door catalog from here — that is the curated
-- index (0001_curation.sql). NOT applied to production without Mike's
-- explicit approval.

CREATE TABLE IF NOT EXISTS payments (
  id                  TEXT PRIMARY KEY,
  sku                 TEXT NOT NULL DEFAULT '',
  price_usd           REAL NOT NULL DEFAULT 0,
  amount_usdc_micros  TEXT NOT NULL DEFAULT '',
  payer               TEXT NOT NULL DEFAULT '',
  network             TEXT NOT NULL DEFAULT '',
  scheme              TEXT NOT NULL DEFAULT 'exact',
  idempotency_key     TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'settled' CHECK (status IN ('settled','failed')),
  tx_hash             TEXT NOT NULL DEFAULT '',
  settled_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- §10 replay protection (structural): a second settle with the same
-- idempotency key is refused by the UNIQUE index, not by application luck.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idem ON payments(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payments_sku ON payments(sku, settled_at);

CREATE TABLE IF NOT EXISTS deliveries (
  id            TEXT PRIMARY KEY,
  payment_id    TEXT NOT NULL,
  sku           TEXT NOT NULL DEFAULT '',
  content_hash  TEXT NOT NULL DEFAULT '',
  delivered_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_deliveries_payment ON deliveries(payment_id);

CREATE TABLE IF NOT EXISTS request_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  path       TEXT NOT NULL DEFAULT '',
  sku        TEXT NOT NULL DEFAULT '',
  method     TEXT NOT NULL DEFAULT '',
  status     INTEGER NOT NULL DEFAULT 0,
  ua_class   TEXT NOT NULL DEFAULT '',
  ts         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_request_log_ts ON request_log(ts);

-- Catalog governance audit — the human-review trail. Every change to what is
-- for sale is an append-only row here: who did it, what action, and why.
-- (Second Wind's deployed promotions table; see docs/labeling-and-taxonomy.md §4.)
CREATE TABLE IF NOT EXISTS promotions (
  id          TEXT PRIMARY KEY,
  sku         TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('promote','update','publish','retire','reprice')),
  actor       TEXT NOT NULL DEFAULT 'mike',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_promotions_sku ON promotions(sku, created_at);
