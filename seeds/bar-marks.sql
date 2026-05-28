-- Patron marks + McDonald's-style counters

CREATE TABLE IF NOT EXISTS bar_counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO bar_counters (key, value) VALUES ('patron_number', 10000);
INSERT OR IGNORE INTO bar_counters (key, value) VALUES ('agents_served', 0);
INSERT OR IGNORE INTO bar_counters (key, value) VALUES ('tasks_sold', 0);

CREATE TABLE IF NOT EXISTS agent_marks (
  id TEXT PRIMARY KEY,
  patron_number INTEGER NOT NULL UNIQUE,
  agent_id TEXT,
  tier TEXT NOT NULL DEFAULT 'visitor',
  product_kind TEXT NOT NULL,
  product_slug TEXT,
  grant_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_marks_agent_id ON agent_marks(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_marks_patron ON agent_marks(patron_number DESC);
CREATE INDEX IF NOT EXISTS idx_agent_marks_created ON agent_marks(created_at DESC);
