-- Migration 027: a one-time free trial for new accounts.
--
-- Until now an account without a plan had zero minutes. A new account now gets
-- 30 minutes once (FREE_TRIAL_MINUTES in src/lib/plans.js), and the rules that
-- stop people farming free transcription by registering account after account
-- live here, in one function, rather than in code the browser can see around:
--
--   * one trial per person, keyed on the normalised email: case, "+anything"
--     and, for Gmail, dots are ignored, so name+1@gmail.com and n.ame@gmail.com
--     are the same person. The row outlives the account, so deleting an
--     account and signing up again does not earn a second trial;
--   * the email must be confirmed;
--   * no trial for throwaway mail domains (disposable_email_domains);
--   * at most 20 new trials in any 24 hours, everyone together. A trial costs
--     well under $0.25, so the worst a script can do is a few dollars a day;
--     past the cap new accounts simply have no free minutes until it frees up.
--
-- Additive. The app reads free_trials and calls claim_free_trial; before this
-- runs, both fail and the app behaves as before (no free minutes).
-- Run in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.free_trials (
  email_key  text PRIMARY KEY,
  user_id    text NOT NULL,
  minutes    integer NOT NULL CHECK (minutes >= 0 AND minutes <= 600),
  granted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS free_trials_user_id ON public.free_trials (user_id);
CREATE INDEX IF NOT EXISTS free_trials_granted_at ON public.free_trials (granted_at);

ALTER TABLE public.free_trials ENABLE ROW LEVEL SECURITY;

-- Your own trial, to show the minutes left; an admin sees all. Nobody writes
-- here directly — only claim_free_trial, below, which runs as the owner.
DROP POLICY IF EXISTS "select_own_or_admin_trial" ON public.free_trials;
CREATE POLICY "select_own_or_admin_trial" ON public.free_trials
  FOR SELECT USING (auth.uid()::text = user_id OR public.is_admin());

CREATE TABLE IF NOT EXISTS public.disposable_email_domains (
  domain text PRIMARY KEY
);
-- Read only by claim_free_trial. RLS on with no policy: invisible to clients.
ALTER TABLE public.disposable_email_domains ENABLE ROW LEVEL SECURITY;

INSERT INTO public.disposable_email_domains (domain) VALUES
  ('10minutemail.com'),('10minutemail.net'),('20minutemail.com'),('33mail.com'),
  ('anonaddy.me'),('burnermail.io'),('discard.email'),('dispostable.com'),
  ('dropmail.me'),('emailondeck.com'),('fakeinbox.com'),('fakemail.net'),
  ('getairmail.com'),('getnada.com'),('guerrillamail.biz'),('guerrillamail.com'),
  ('guerrillamail.de'),('guerrillamail.info'),('guerrillamail.net'),('guerrillamail.org'),
  ('guerrillamailblock.com'),('grr.la'),('harakirimail.com'),('inboxbear.com'),
  ('inboxkitten.com'),('mail.tm'),('mailcatch.com'),('maildrop.cc'),
  ('mailinator.com'),('mailinator.net'),('mailnesia.com'),('mailpoof.com'),
  ('mintemail.com'),('mohmal.com'),('moakt.com'),('mytemp.email'),
  ('nada.email'),('sharklasers.com'),('spam4.me'),('spambox.us'),
  ('spamgourmet.com'),('temp-mail.io'),('temp-mail.org'),('tempail.com'),
  ('tempmail.com'),('tempmail.dev'),('tempmail.net'),('tempmail.plus'),
  ('tempmailo.com'),('tempr.email'),('throwawaymail.com'),('tmail.ws'),
  ('tmpmail.net'),('tmpmail.org'),('trashmail.com'),('trashmail.de'),
  ('trashmail.net'),('yopmail.com'),('yopmail.fr'),('yopmail.net'),
  ('emailfake.com'),('cmail.club'),('linshiyouxiang.net'),('1secmail.com'),
  ('1secmail.net'),('1secmail.org'),('esiix.com'),('wwjmp.com'),
  ('xojxe.com'),('kzccv.com'),('qiott.com'),('vjuum.com'),('laafd.com'),
  ('txcct.com'),('rteet.com'),('dpptd.com'),('emltmp.com'),('tmpbox.net'),
  ('tmpeml.com'),('minuteinbox.com'),('fexpost.com'),('fexbox.org'),
  ('mailbox.in.ua'),('rover.info'),('inpwa.com'),('intempmail.com'),
  ('smartnator.com'),('pokemail.net'),('spamdecoy.net'),('mailtemp.uk')
ON CONFLICT DO NOTHING;

-- One person, one key. Lowercased; "+tag" dropped for every domain (the
-- common providers all deliver it to the same box); Gmail also ignores dots
-- and answers as googlemail.com.
CREATE OR REPLACE FUNCTION public.normalize_email(e text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH parts AS (
    SELECT split_part(split_part(lower(trim(e)), '@', 1), '+', 1) AS local,
           split_part(lower(trim(e)), '@', 2) AS domain
  ), g AS (
    SELECT local, CASE WHEN domain = 'googlemail.com' THEN 'gmail.com' ELSE domain END AS domain FROM parts
  )
  SELECT CASE WHEN domain = 'gmail.com' THEN replace(local, '.', '') ELSE local END || '@' || domain FROM g
$$;

-- Grants the caller a trial if they may have one. Returns
--   { granted: true,  minutes, granted_at }                  — new or existing
--   { granted: false, reason }   reason: not_signed_in | not_confirmed |
--                                        disposable | used | paused
-- Safe to call on every page load: an account that already has its trial gets
-- the same answer back, and nothing else changes.
CREATE OR REPLACE FUNCTION public.claim_free_trial()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  uid       uuid := auth.uid();
  u_email   text;
  confirmed timestamptz;
  k         text;
  existing  public.free_trials;
  daily_cap constant integer := 20;
  trial_min constant integer := 30;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('granted', false, 'reason', 'not_signed_in'); END IF;

  SELECT * INTO existing FROM public.free_trials WHERE user_id = uid::text LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('granted', true, 'minutes', existing.minutes, 'granted_at', existing.granted_at);
  END IF;

  SELECT email, email_confirmed_at INTO u_email, confirmed FROM auth.users WHERE id = uid;
  IF u_email IS NULL OR confirmed IS NULL THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'not_confirmed');
  END IF;

  k := public.normalize_email(u_email);
  IF EXISTS (SELECT 1 FROM public.disposable_email_domains WHERE domain = split_part(k, '@', 2)) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'disposable');
  END IF;

  -- One claim at a time, so the daily cap cannot be overrun by a burst.
  PERFORM pg_advisory_xact_lock(hashtext('claim_free_trial'));

  IF EXISTS (SELECT 1 FROM public.free_trials WHERE email_key = k) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'used');
  END IF;
  IF (SELECT count(*) FROM public.free_trials WHERE granted_at > now() - interval '24 hours') >= daily_cap THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'paused');
  END IF;

  INSERT INTO public.free_trials (email_key, user_id, minutes) VALUES (k, uid::text, trial_min)
    RETURNING * INTO existing;
  RETURN jsonb_build_object('granted', true, 'minutes', existing.minutes, 'granted_at', existing.granted_at);
END $$;

REVOKE ALL ON FUNCTION public.claim_free_trial() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_free_trial() TO authenticated;

NOTIFY pgrst, 'reload schema';
