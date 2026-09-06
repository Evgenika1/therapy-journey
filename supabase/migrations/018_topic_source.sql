-- Migration 018: where a next-session topic came from.
--
-- Topics used to be things the user typed. The session analysis now also
-- proposes them (its "for_next_session" — threads explicitly left hanging), and
-- those need to be told apart from your own notes: marked in the list, and
-- replaced rather than duplicated when the same session is analysed again.
--
-- `source` is 'manual' or 'ai'. `session_id` is set only for AI topics and is
-- what makes the replace-on-re-analysis possible; deleting a session takes its
-- proposed topics with it, which is the right outcome — they were about that
-- session's loose ends.
--
-- Both are optional at the app level: topics.save drops whichever column the
-- database says it does not have and retries, so an un-migrated database keeps
-- saving topics as before. Run in the Supabase SQL editor.

ALTER TABLE public.next_session_topics
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

ALTER TABLE public.next_session_topics
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.sessions(id) ON DELETE CASCADE;

-- Rows that predate this column were all typed by hand.
UPDATE public.next_session_topics SET source = 'manual' WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS next_session_topics_session_id_idx
  ON public.next_session_topics (session_id);

NOTIFY pgrst, 'reload schema';
