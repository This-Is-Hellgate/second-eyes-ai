-- Preserve product_kind / product_slug on the settlement row itself, and
-- backfill historical grants. IDEMPOTENT / backfill-safe: re-running this file
-- is a no-op past the first run.
--
-- WHY: /api/bar/proof/payments derived product_slug only via a LEFT JOIN to
-- idempotency_keys, which is written ONLY when the buyer sends an Idempotency-Key
-- header. Autonomous x402 buyers that omit that header settled fine and got a
-- patron mark (which carries the slug) but left recent_settlements.product_slug
-- null — degrading audit/Bazaar trust even though recent_purchases showed the slug.
--
-- COLUMN CREATION: the product_kind / product_slug columns are added by the
-- runtime guard ensureGrantProductColumns() in functions/_lib/a4a-store.js (it
-- gates ALTER ADD COLUMN on pragma_table_info, so it is safe and runs on the first
-- settlement after deploy), or by scripts/migrate-grant-product-metadata.mjs for an
-- operator-driven run. They are intentionally NOT added here: SQLite ALTER TABLE
-- ADD COLUMN is not idempotent, so a bare ALTER in this file aborts the WHOLE file
-- (and the backfill below) the moment the columns already exist — which they do as
-- soon as one settlement has landed. That abort is the prod "duplicate column"
-- failure. Keeping only the idempotent backfill here makes the file re-runnable.
--
-- DO NOT run this file directly with `wrangler d1 execute --file` on a DB where
-- the columns do not exist yet: the CREATE INDEX and UPDATEs below reference
-- product_slug / product_kind, so SQLite aborts the whole file if they are absent.
-- Use the guarded migration script, which adds any missing columns idempotently
-- FIRST, then runs this backfill — safe in either column state:
--   node scripts/migrate-grant-product-metadata.mjs --remote   # (or --dry-run)
-- The d1-migrate workflow auto-routes this filename through that script, so the
-- workflow path is safe too. Running this file alone is only safe once the columns
-- already exist (e.g. after the runtime guard ensureGrantProductColumns()).

CREATE INDEX IF NOT EXISTS idx_access_grants_product_slug ON access_grants(product_slug);

-- Backfill historical grants from the patron-mark table (source that retained slug),
-- then from any idempotency_keys rows that did get written. COALESCE + the IS NULL
-- guard make every UPDATE a no-op once the row is populated, so re-runs are safe.
UPDATE access_grants
SET product_kind = COALESCE(product_kind, (
      SELECT m.product_kind FROM agent_marks m
      WHERE m.grant_id = access_grants.id LIMIT 1
    )),
    product_slug = COALESCE(product_slug, (
      SELECT m.product_slug FROM agent_marks m
      WHERE m.grant_id = access_grants.id LIMIT 1
    ))
WHERE product_slug IS NULL OR product_kind IS NULL;

UPDATE access_grants
SET product_kind = COALESCE(product_kind, (
      SELECT ik.product_kind FROM idempotency_keys ik
      WHERE ik.grant_id = access_grants.id LIMIT 1
    )),
    product_slug = COALESCE(product_slug, (
      SELECT ik.product_slug FROM idempotency_keys ik
      WHERE ik.grant_id = access_grants.id LIMIT 1
    ))
WHERE product_slug IS NULL OR product_kind IS NULL;
