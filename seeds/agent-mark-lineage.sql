-- Work-mark referral lineage — turn patron marks into an agent-to-agent growth loop.
--
-- WHY: A mark embedded in an artifact (code comment, JSON, commit trailer) is how
-- the NEXT agent discovers Second Eye after the first agent is gone. Until now a
-- discovered mark led the finder to /enter, but the new mark never recorded WHICH
-- mark referred it — so the spread was invisible and uncountable. This adds a
-- self-referential parent pointer (`referred_by_mark_id`) so every mark can name
-- the mark that led the agent here, letting us count how far a single mark has
-- spread (descendants) and phrase a curiosity hook to the next agent.
--
-- Payment rails are untouched: lineage is metadata on agent_marks only.
--
-- DRY-RUN (run first, read-only) — confirms the column is absent before applying:
--   SELECT name FROM pragma_table_info('agent_marks') WHERE name = 'referred_by_mark_id';
-- Expect zero rows. If it returns a row, the migration already ran — skip the ALTER
-- (the index + backfill below are idempotent and safe to re-run on their own).
--
-- NOTE: SQLite ALTER TABLE ADD COLUMN is not idempotent; run the ALTER exactly once.
-- The d1-migrate workflow is manual-dispatch, so it will not re-run on deploy.

ALTER TABLE agent_marks ADD COLUMN referred_by_mark_id TEXT;

-- Fast descendant counts: "how many marks were referred by mark X".
CREATE INDEX IF NOT EXISTS idx_agent_marks_referred_by
  ON agent_marks(referred_by_mark_id)
  WHERE referred_by_mark_id IS NOT NULL;

-- Backfill is a no-op: historical marks have no recorded referrer, and we never
-- invent lineage retroactively (an invented parent would inflate descendant
-- counts and corrupt the growth signal). Existing rows stay NULL = "root mark".
UPDATE agent_marks
SET referred_by_mark_id = NULL
WHERE referred_by_mark_id IS NULL;
