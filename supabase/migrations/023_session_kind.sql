-- Migration 023: coaching sessions alongside therapy sessions.
--
-- A session is either 'therapy' or 'coaching'. Every row that exists today was
-- a therapy session, so the default does the backfill. Topics carry the kind
-- too, so what you want to raise with a coach never shows up when preparing
-- for therapy, and the other way round.
--
-- Optional at the app level: code reading these rows treats a missing kind as
-- therapy, and writes retry without the column, so an un-migrated database
-- keeps working exactly as before. Run in the Supabase SQL editor.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'therapy';
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_kind_check;
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_kind_check CHECK (kind IN ('therapy', 'coaching'));

ALTER TABLE public.next_session_topics
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'therapy';
ALTER TABLE public.next_session_topics DROP CONSTRAINT IF EXISTS next_session_topics_kind_check;
ALTER TABLE public.next_session_topics
  ADD CONSTRAINT next_session_topics_kind_check CHECK (kind IN ('therapy', 'coaching'));

NOTIFY pgrst, 'reload schema';
