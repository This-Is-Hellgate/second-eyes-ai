-- One-time micro tap redemption tracking

CREATE TABLE IF NOT EXISTS micro_redemptions (
  jti TEXT PRIMARY KEY,
  tap_slug TEXT NOT NULL,
  grant_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_micro_redemptions_tap ON micro_redemptions(tap_slug);
