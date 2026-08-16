-- Migration 015: link sessions created from a Recall.ai bot recording.
--
-- recall_bot_id ties a session to the Recall bot that produced it, and the
-- unique index lets the webhook and the client-poll path dedupe (both use an
-- upsert on recall_bot_id) so a single meeting can't create two sessions.
-- Normal (mic/tab) recordings leave it NULL — the partial index allows many
-- NULLs. Run in the Supabase SQL editor.

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS recall_bot_id text;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_recall_bot_id_key
  ON public.sessions (recall_bot_id)
  WHERE recall_bot_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
