-- Migration 025: a monthly allowance per account.
--
-- MONTHLY_MINUTES in src/lib/usageQuota.js was one constant for everyone, so
-- giving one person more minutes meant editing code and deploying. An account
-- with a row here uses that number instead; an account without one keeps the
-- default, which is why nothing needs backfilling.
--
-- Written only by an admin, in the app's Usage page or here. The value is
-- bounded on both sides: 0 is a real answer (no allowance), and the ceiling
-- matches MAX_QUOTA_MINUTES so a stray zero on 400 cannot hand out a fortune.
--
-- Additive: code that cannot read this table falls back to the default, so the
-- site keeps working before and after it runs. Run in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.user_quota (
  user_id         text PRIMARY KEY,
  monthly_minutes integer NOT NULL CHECK (monthly_minutes >= 0 AND monthly_minutes <= 20000),
  -- Why this account is different. For the admin's own memory; nothing reads it.
  note            text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_quota ENABLE ROW LEVEL SECURITY;

-- You may read your own allowance — the dashboard shows the minutes left
-- against it. An admin may read everyone's, to edit them.
DROP POLICY IF EXISTS "select_own_or_admin_quota" ON public.user_quota;
CREATE POLICY "select_own_or_admin_quota" ON public.user_quota
  FOR SELECT USING (auth.uid()::text = user_id OR public.is_admin());

-- Only an admin may set an allowance, and nobody may raise their own unless
-- they are one: the gate that spends money reads this table.
DROP POLICY IF EXISTS "insert_admin_quota" ON public.user_quota;
CREATE POLICY "insert_admin_quota" ON public.user_quota
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "update_admin_quota" ON public.user_quota;
CREATE POLICY "update_admin_quota" ON public.user_quota
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Deleting a row restores the default rather than removing an allowance.
DROP POLICY IF EXISTS "delete_admin_quota" ON public.user_quota;
CREATE POLICY "delete_admin_quota" ON public.user_quota
  FOR DELETE USING (public.is_admin());

NOTIFY pgrst, 'reload schema';
