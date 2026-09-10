-- Migration 022: what each account spends, and who is allowed to see it.
--
-- Two audiences, one table. The account owner sees a single number — minutes
-- left this month — and the admin sees what it actually cost, per user, per
-- kind, in dollars. Both are computed from the same append-only ledger, so
-- there is no second figure to reconcile.
--
-- The ledger's unit is money, because it is the only one all four cost sources
-- share: AssemblyAI bills per hour of audio, the three Claude routes per token.
-- Minutes are derived at display time and never stored — see src/lib/usageQuota.js.
--
-- Run in the Supabase SQL editor.

-- ── who is an admin ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admins (
  user_id    text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- You may check whether YOU are an admin; you may not read the list of who is.
DROP POLICY IF EXISTS "select_own_admin_row" ON public.admins;
CREATE POLICY "select_own_admin_row" ON public.admins
  FOR SELECT USING (auth.uid()::text = user_id::text);

-- Membership is granted by hand in the SQL editor. There is deliberately no
-- INSERT/UPDATE/DELETE policy: nothing in the application can promote an
-- account, so a bug in the app cannot hand someone else's therapy data away.

-- SECURITY DEFINER so a policy can ask "is the caller an admin" without the
-- caller being able to read the admins table itself. search_path is pinned:
-- without it, a schema earlier on the caller's path could shadow `admins`.
CREATE OR REPLACE FUNCTION public.is_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid()::text);
$$;

-- ── the ledger ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.usage_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  -- Ties a transcription and the analysis that followed it to one session, so
  -- the admin view can answer "what did this session cost" rather than only
  -- "what did this month cost".
  session_id    uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (kind IN ('transcribe', 'analyze', 'chat', 'patterns')),
  model         text,
  audio_seconds integer CHECK (audio_seconds IS NULL OR audio_seconds >= 0),

  input_tokens       integer,
  output_tokens      integer,
  cache_read_tokens  integer,
  cache_write_tokens integer,

  -- Never negative. Remaining minutes are derived by subtracting the month's
  -- sum from the quota, so a row with a negative cost would top the account up.
  cost_usd      numeric(12,6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- The provider's id for the thing being billed — for transcription, the
  -- AssemblyAI job id. Charging happens when a poll first sees the job
  -- completed, and the client polls a job more than once: a reload that
  -- re-polls a finished job would otherwise bill the same audio twice. The
  -- unique index below makes the second write fail instead.
  external_id   text
);

CREATE UNIQUE INDEX IF NOT EXISTS usage_events_external_idx
  ON public.usage_events (user_id, kind, external_id)
  WHERE external_id IS NOT NULL;

-- The hot query is "this user, this month".
CREATE INDEX IF NOT EXISTS usage_events_user_created_idx
  ON public.usage_events (user_id, created_at DESC);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_or_admin_usage" ON public.usage_events;
CREATE POLICY "select_own_or_admin_usage" ON public.usage_events
  FOR SELECT USING (auth.uid()::text = user_id::text OR public.is_admin());

DROP POLICY IF EXISTS "insert_own_usage" ON public.usage_events;
CREATE POLICY "insert_own_usage" ON public.usage_events
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

-- No UPDATE or DELETE policy, for anyone, on purpose. RLS denies what it does
-- not explicitly allow, and this is the whole integrity story: the balance is
-- derived from these rows, so an account that can delete its own rows can reset
-- its own bill. Corrections are made by hand in the SQL editor.

NOTIFY pgrst, 'reload schema';
