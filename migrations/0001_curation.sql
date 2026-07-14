-- Second Eyes curation graph — the moat. NOT applied to production without
-- Mike's explicit approval; local/test application is fine.
--
-- The product is the resolved verification capability plus the judgment around
-- it: items carry the door stub (few words), the guidance (the voice), and how
-- to invoke; edges carry the OPINION about how doors route into one another
-- (help-me -> schema-repair / context-pressure / should-i-pay, each edge with
-- its one-line WHY). A flat list of endpoints has no equivalent of this graph.
--
-- Naming rule (enforced by scripts/selftest.mjs): `name` is the failure in the
-- agent's own words — 3-5 plain words, no hyphens, never a slug echo
-- ("I am looping", "should I pay this"); `slug` carries the taxonomy
-- (loop-detect, should-i-pay).

CREATE TABLE IF NOT EXISTS items (
  sku            TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,                 -- symptom, agent's words (free)
  kind           TEXT NOT NULL CHECK (kind IN ('check','meta-tool','guide','pack')),
  service        TEXT NOT NULL DEFAULT '',      -- grouping (e.g. distress, payment, media)
  summary        TEXT NOT NULL,                 -- stub: what/when in a few words (free)
  guidance       TEXT NOT NULL DEFAULT '',      -- the voice: when to reach for it, wiring, gotchas (paid)
  price_usd      REAL NOT NULL CHECK (price_usd > 0 AND price_usd <= 1.00),
  invoke_kind    TEXT NOT NULL DEFAULT 'resolve' CHECK (invoke_kind IN ('resolve','verdict','workersai','r2')),
  invoke_key     TEXT NOT NULL DEFAULT '',      -- workersai model id, or R2 object key
  input_schema   TEXT NOT NULL DEFAULT '',      -- JSON Schema (verdict/workersai POST body)
  input_example  TEXT NOT NULL DEFAULT '',      -- JSON example body (verdict/workersai)
  mime_type      TEXT NOT NULL DEFAULT '',      -- artifact delivery type (r2 kind)
  source_repo    TEXT NOT NULL DEFAULT '',
  source_path    TEXT NOT NULL DEFAULT '',
  source_url     TEXT NOT NULL DEFAULT '',
  license_spdx   TEXT NOT NULL DEFAULT '',
  provenance     TEXT NOT NULL DEFAULT '',
  content_hash   TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','retired')),
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- The routing graph: first-class curation, not a README.
CREATE TABLE IF NOT EXISTS edges (
  from_sku   TEXT NOT NULL REFERENCES items(sku),
  to_sku     TEXT NOT NULL REFERENCES items(sku),
  relation   TEXT NOT NULL CHECK (relation IN ('composes_with','requires','step_of','alternative_to','pairs_with','supersedes')),
  position   INTEGER,                            -- ordering for step_of (workflow steps)
  note       TEXT NOT NULL DEFAULT '',           -- one line of WHY — the opinion
  PRIMARY KEY (from_sku, to_sku, relation)
);

CREATE INDEX IF NOT EXISTS idx_items_live ON items(status, kind, service);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_sku);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_sku);
