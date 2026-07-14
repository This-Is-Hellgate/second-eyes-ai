-- Second Eyes curation catalog — the moat. NOT applied to production without
-- explicit approval (SPEC rule #4); local/test application is fine.
--
-- Modeled on Second Wind's deployed catalog_items system (see
-- docs/labeling-and-taxonomy.md). Two label tables (services, categories) sit
-- above items; edges carry the routing graph. Every item has an EXTERNAL stub
-- (free, agent-scannable) and INTERNAL substance (paid) — the wall between them
-- is enforced by scripts/selftest.mjs, which also refuses an empty-payload slug.

-- The capability area an item belongs to (agent-reliability, payments, ...).
CREATE TABLE IF NOT EXISTS services (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'area' CHECK (kind IN ('area','platform','protocol')),
  description TEXT NOT NULL DEFAULT ''
);

-- A domain/category path under a service (agent-reliability/loop-recovery, ...).
CREATE TABLE IF NOT EXISTS categories (
  slug        TEXT PRIMARY KEY,   -- "<domain>/<category>"
  domain      TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS items (
  -- ---- identity (three layers — docs/labeling-and-taxonomy.md §1) -----------
  sku            TEXT PRIMARY KEY,              -- SE-<FAMILY>-<SEQ>, permanent, ops/audit
  slug           TEXT NOT NULL UNIQUE,          -- taxonomy / URL
  name           TEXT NOT NULL,                 -- symptom in the agent's words (free)
  item_type      TEXT NOT NULL CHECK (item_type IN ('meta-tool','check','cookbook','dataset','bundle','guide','template','tool')),
  service_slug   TEXT NOT NULL REFERENCES services(slug),
  category_slug  TEXT NOT NULL REFERENCES categories(slug),
  price_usd      REAL NOT NULL CHECK (price_usd >= 0 AND price_usd <= 1.00),
  -- ---- EXTERNAL stub (free) -------------------------------------------------
  summary        TEXT NOT NULL,                 -- what/when in a few words (free)
  token_estimate INTEGER NOT NULL DEFAULT 0,    -- context weight of the deliverable (free hint)
  -- ---- INTERNAL substance (paid; never on a free surface) -------------------
  guidance       TEXT NOT NULL DEFAULT '',      -- the voice: when to reach for it, wiring, gotchas
  tool_code      TEXT NOT NULL DEFAULT '',      -- shippable code payload (cookbook/template/tool)
  reference_doc  TEXT NOT NULL DEFAULT '',      -- shippable doc payload (guide/dataset)
  language       TEXT NOT NULL DEFAULT '' CHECK (language IN ('','typescript','python','both')),
  -- ---- invocation ----------------------------------------------------------
  invoke_kind    TEXT NOT NULL DEFAULT 'resolve' CHECK (invoke_kind IN ('resolve','verdict','workersai','r2')),
  invoke_key     TEXT NOT NULL DEFAULT '',      -- workersai model id, or R2 object key
  input_schema   TEXT NOT NULL DEFAULT '',      -- JSON Schema (verdict/workersai POST body)
  input_example  TEXT NOT NULL DEFAULT '',      -- JSON example body
  mime_type      TEXT NOT NULL DEFAULT '',      -- artifact delivery type (r2)
  -- ---- provenance / trust (human review) -----------------------------------
  source_repo    TEXT NOT NULL DEFAULT '',
  source_url     TEXT NOT NULL DEFAULT '',
  license_spdx   TEXT NOT NULL DEFAULT '',
  provenance     TEXT NOT NULL DEFAULT 'synthesized' CHECK (provenance IN ('upstream','synthesized','hybrid')),
  content_hash   TEXT NOT NULL DEFAULT '',
  -- ---- lifecycle -----------------------------------------------------------
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','retired')),
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  published_at   TEXT
);

-- The routing graph: first-class curation, not a README. Each edge carries WHY.
CREATE TABLE IF NOT EXISTS edges (
  from_sku   TEXT NOT NULL REFERENCES items(sku),
  to_sku     TEXT NOT NULL REFERENCES items(sku),
  relation   TEXT NOT NULL CHECK (relation IN ('composes_with','requires','step_of','alternative_to','pairs_with','supersedes')),
  position   INTEGER,                            -- ordering for step_of
  note       TEXT NOT NULL DEFAULT '',           -- one line of WHY — the opinion
  PRIMARY KEY (from_sku, to_sku, relation)
);

CREATE INDEX IF NOT EXISTS idx_items_live ON items(status, service_slug, category_slug);
CREATE INDEX IF NOT EXISTS idx_items_type ON items(item_type);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_sku);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_sku);
