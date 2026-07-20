-- Migration 011: Enable Row Level Security on all user data tables
-- Run in Supabase SQL Editor.
--
-- Context: verified live on 2026-07-19 that `sessions` and `emotion_logs`
-- were readable via the public anon key with no authentication at all
-- (RLS was never enabled on these tables). This migration locks every
-- user-data table down to auth.uid() = user_id for all operations.

ALTER TABLE public.sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diary_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emotion_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_journal_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.next_session_topics  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chats             ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sessions', 'diary_entries', 'emotion_logs', 'homework',
    'journal_entries', 'custom_journal_types', 'next_session_topics', 'ai_chats'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "select_own_%1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "insert_own_%1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "update_own_%1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "delete_own_%1$s" ON public.%1$I', t);

    EXECUTE format(
      'CREATE POLICY "select_own_%1$s" ON public.%1$I FOR SELECT USING (auth.uid() = user_id)', t);
    EXECUTE format(
      'CREATE POLICY "insert_own_%1$s" ON public.%1$I FOR INSERT WITH CHECK (auth.uid() = user_id)', t);
    EXECUTE format(
      'CREATE POLICY "update_own_%1$s" ON public.%1$I FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t);
    EXECUTE format(
      'CREATE POLICY "delete_own_%1$s" ON public.%1$I FOR DELETE USING (auth.uid() = user_id)', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
