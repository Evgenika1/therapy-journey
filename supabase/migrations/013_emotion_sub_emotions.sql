-- Migration 013: Allow multiple sub-emotions per emotion log
-- Run in Supabase SQL Editor.
--
-- Adds a jsonb array column so one emotional check-in (one row, one
-- intensity) can carry several sub-emotions of the same category,
-- e.g. Calm -> ["safe", "grounded", "peaceful"].

ALTER TABLE public.emotion_logs
  ADD COLUMN IF NOT EXISTS sub_emotions jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
