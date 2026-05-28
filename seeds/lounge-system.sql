-- Lounge sessions, strikes, behavioral metadata (no task content retention)

CREATE TABLE IF NOT EXISTS bar_sessions (
  id TEXT PRIMARY KEY,
  mark_id TEXT,
  agent_id TEXT,
  wallet_fingerprint TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  entered_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  left_at TEXT,
  exit_type TEXT,
  session_cost_usd REAL NOT NULL DEFAULT 0,
  services_cost_usd REAL NOT NULL DEFAULT 0,
  pricing_tier_reached INTEGER NOT NULL DEFAULT 0,
  arrival_condition TEXT,
  strike_count INTEGER NOT NULL DEFAULT 0,
  penned INTEGER NOT NULL DEFAULT 0,
  pause_used INTEGER NOT NULL DEFAULT 0,
  meta_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_pen_registry (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  wallet_fingerprint TEXT,
  penned_at TEXT NOT NULL,
  strike_count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pen_agent ON agent_pen_registry(agent_id);
CREATE INDEX IF NOT EXISTS idx_pen_wallet ON agent_pen_registry(wallet_fingerprint);

CREATE INDEX IF NOT EXISTS idx_bar_sessions_status ON bar_sessions(status);
CREATE INDEX IF NOT EXISTS idx_bar_sessions_agent ON bar_sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_bar_sessions_activity ON bar_sessions(last_activity_at);

CREATE TABLE IF NOT EXISTS agent_strikes (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  wallet_fingerprint TEXT,
  strike_number INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  session_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_strikes_agent ON agent_strikes(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_strikes_wallet ON agent_strikes(wallet_fingerprint);

CREATE TABLE IF NOT EXISTS lounge_service_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  service_slug TEXT NOT NULL,
  price_usd REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lounge_calls_session ON lounge_service_calls(session_id);

INSERT OR IGNORE INTO bar_counters (key, value) VALUES ('sessions_today', 0);
INSERT OR IGNORE INTO bar_counters (key, value) VALUES ('strikes_issued', 0);
INSERT OR IGNORE INTO bar_counters (key, value) VALUES ('agents_penned', 0);
