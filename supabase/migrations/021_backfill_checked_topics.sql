-- Migration 021: the topics stranded between the two old lists.
--
-- A finished topic used to have two possible resting places: checked but not
-- archived, folded under "✓ N done", or archived and in "Past topics".
-- Removing the fold leaves the first kind visible in neither list — not pending
-- (it is checked), not archived (it is not). This moves them into the archive,
-- which is now the only place a finished topic lives.
--
-- archived_at uses COALESCE so a row that somehow already carries a stamp keeps
-- it. The rest get now(), which is the honest answer available: the moment they
-- were checked was never recorded, and inventing one would be worse than
-- admitting that this is when they reached the archive.
--
-- Ticking a topic off now sets both flags in a single write (topics.archive),
-- so this backfill is a one-off for rows created before that change. Run in the
-- Supabase SQL editor.

UPDATE public.next_session_topics
   SET archived    = true,
       archived_at = COALESCE(archived_at, now())
 WHERE checked = true
   AND archived = false;
