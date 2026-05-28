-- A4A commerce persistence (required for production agent checkout on Cloudflare Workers)

CREATE TABLE IF NOT EXISTS a4a_tasks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  requirements_json TEXT NOT NULL,
  payment_payload_json TEXT,
  receipt_json TEXT,
  access_grant_id TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_a4a_tasks_status ON a4a_tasks(status);
CREATE INDEX IF NOT EXISTS idx_a4a_tasks_expires ON a4a_tasks(expires_at);

CREATE TABLE IF NOT EXISTS access_grants (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  rail TEXT NOT NULL,
  payer_ref TEXT,
  tx_ref TEXT,
  task_id TEXT,
  stripe_session_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_access_grants_task ON access_grants(task_id);
CREATE INDEX IF NOT EXISTS idx_access_grants_created ON access_grants(created_at);
