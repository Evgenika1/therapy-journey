-- Migration 012: Link ai_chats to a session
-- Run in Supabase SQL Editor.
--
-- Needed so the AI chat panel on the Sessions page can persist its
-- conversation per-session instead of only in local React state.

ALTER TABLE public.ai_chats
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ai_chats_session_id_idx ON public.ai_chats(session_id);

NOTIFY pgrst, 'reload schema';
