-- Migration 017: optional free-text note on an emotion log.
--
-- Selecting a category and a few sub-emotions records WHAT was felt but not
-- what it was about. The note carries the context — "поругалась с мамой",
-- "хорошо прошла сессия" — which is what makes the log readable months later
-- and gives the pattern analysis something concrete to work with.
--
-- Optional by design: the column is nullable and the app drops it from the
-- insert if it is missing, so an un-migrated database still records emotions.
-- Run in the Supabase SQL editor.

ALTER TABLE public.emotion_logs ADD COLUMN IF NOT EXISTS note text;

NOTIFY pgrst, 'reload schema';
