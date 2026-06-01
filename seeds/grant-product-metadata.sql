-- Preserve product_kind / product_slug on the settlement row itself.
--
-- WHY: /api/bar/proof/payments derived product_slug only via a LEFT JOIN to
-- idempotency_keys, which is written ONLY when the buyer sends an Idempotency-Key
-- header. Autonomous x402 buyers that omit that header settled fine and got a
-- patron mark (which carries the slug) but left recent_settlements.product_slug
-- null — degrading audit/Bazaar trust even though recent_purchases showed the slug.
--
-- This makes the grant row self-describing so the ledger never depends on the
-- optional idempotency row.
--
-- DRY-RUN (run first, read-only) — confirms columns are absent before applying:
--   SELECT name FROM pragma_table_info('access_grants')
--   WHERE name IN ('product_kind','product_slug');
-- Expect zero rows. If it returns rows, the migration already ran — skip the ALTERs.
--
-- NOTE: SQLite ALTER TABLE ADD COLUMN is not idempotent; run this file exactly once
-- (the D1 migrate workflow is manual-dispatch, so it will not re-run on deploy).

ALTER TABLE access_grants ADD COLUMN product_kind TEXT;
ALTER TABLE access_grants ADD COLUMN product_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_access_grants_product_slug ON access_grants(product_slug);

-- Backfill historical grants from the patron-mark table (source that retained slug),
-- then from any idempotency_keys rows that did get written. Safe to re-run.
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
