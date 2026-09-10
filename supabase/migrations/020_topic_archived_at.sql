-- Migration 020: when a topic was filed away.
--
-- Migration 019 made archiving possible; this records the moment. The archive
-- view groups by it — "these are the topics your 7 September session raised" —
-- and without a date the archive is a flat list of everything you ever ticked
-- off, in no order anyone can read.
--
-- created_at is not a substitute: it is when the thought was captured, often
-- weeks before the session that finally raised it. The view falls back to it
-- when this column is absent, but then labels the heading "Added" rather than
-- claiming an archive date it cannot prove.
--
-- Nullable on purpose. Rows archived before this migration genuinely have no
-- known archive date, and backfilling now() would state, falsely, that they
-- were all filed the moment the migration ran.
--
-- Optional at the app level: archiveDiscussed drops the column and retries when
-- the database does not have it, so archiving keeps working either way. Run in
-- the Supabase SQL editor.

ALTER TABLE public.next_session_topics
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

NOTIFY pgrst, 'reload schema';
