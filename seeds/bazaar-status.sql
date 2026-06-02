-- Bazaar discovery status captured from CDP settle EXTENSION-RESPONSES header.
--
-- DRY-RUN (run first, read-only) — confirms columns are absent before applying:
--   SELECT name FROM pragma_table_info('access_grants')
--   WHERE name IN ('bazaar_status','bazaar_reason');
-- Expect zero rows. If it returns rows, the migration already ran — skip the ALTERs.
--
-- NOTE: SQLite ALTER TABLE ADD COLUMN is not idempotent; a re-run fails with
-- "duplicate column name" — that is harmless (the column already exists), not data loss.
-- See docs/external-payer-monitoring.md#d1-migrations-avoiding-scary-duplicate-column-failures.
ALTER TABLE access_grants ADD COLUMN bazaar_status TEXT;
ALTER TABLE access_grants ADD COLUMN bazaar_reason TEXT;
