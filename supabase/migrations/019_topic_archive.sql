-- Migration 019: filing away the topics a session already raised.
--
-- The Dashboard block answers one question: "what do I want to bring to my
-- next session?" Once a session happens, the topics it raised have been
-- answered — but the old behaviour left them in the list forever, folded under
-- "discussed", so the block slowly filled with the history of every session
-- instead of the shortlist for the next one.
--
-- Archiving is not deletion. These rows are the record of what was actually
-- raised, which is worth keeping and is not recoverable if dropped; `archived`
-- simply takes them out of the live list. Recording a session archives the
-- topics ticked off before it — the unticked ones were never raised, so they
-- carry over rather than being cleared.
--
-- Optional at the app level: topics.list falls back to an unfiltered query and
-- archiveDiscussed becomes a no-op when the column is absent, so an un-migrated
-- database keeps working exactly as before. Run in the Supabase SQL editor.

ALTER TABLE public.next_session_topics
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

-- The live list is the hot query — every Dashboard load filters on this.
CREATE INDEX IF NOT EXISTS next_session_topics_archived_idx
  ON public.next_session_topics (user_id, archived);

NOTIFY pgrst, 'reload schema';
