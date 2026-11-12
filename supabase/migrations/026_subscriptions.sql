-- Migration 026: Stripe subscriptions.
--
-- A subscription sets two things and nothing else: how many minutes the account
-- may spend, and over which period. What it has spent is still derived from
-- usage_events (migration 022) on every read — no counter column here to drift,
-- double-count from two tabs, or forget to reset. The period resets itself: a
-- new current_period_start means the sum starts again from there.
--
-- Minutes per plan live in code (src/lib/plans.js), not here, so changing them
-- is a commit rather than a migration. An account's own row in user_quota
-- (migration 025) still overrides the plan: that is how the owner's and test
-- accounts keep working without paying.
--
-- Written only by the Stripe webhook, with the service-role key. Run in the
-- Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id                text PRIMARY KEY,
  stripe_customer_id     text NOT NULL UNIQUE,
  stripe_subscription_id text UNIQUE,
  plan                   text CHECK (plan IS NULL OR plan IN ('starter', 'pro', 'intensive')),
  -- Stripe's own status: active, past_due, canceled, incomplete, unpaid, …
  -- Which of them grant minutes is decided in code (src/lib/plans.js).
  status                 text NOT NULL DEFAULT 'incomplete',
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- You may read your own subscription — the Billing page shows it. An admin may
-- read everyone's.
DROP POLICY IF EXISTS "select_own_or_admin_subscription" ON public.subscriptions;
CREATE POLICY "select_own_or_admin_subscription" ON public.subscriptions
  FOR SELECT USING (auth.uid()::text = user_id OR public.is_admin());

-- No INSERT, UPDATE or DELETE policy, for anyone, on purpose. The gate that
-- spends money reads this table: an account that could write its own row could
-- give itself Intensive. The webhook writes with the service-role key, which
-- bypasses RLS; nothing running with a user's session can.

NOTIFY pgrst, 'reload schema';
