// Plans, and where an account's allowance comes from.
//
// Sold as sessions, metered in minutes. "4 sessions a month" is what a person
// can picture; the ledger (migration 022) counts minutes, because a two-hour
// session and a twenty-minute check-in are not the same cost. One session is
// taken as 100 minutes: an hour of audio is ~68 minutes of allowance once its
// analysis is added (see usageQuota.js), which leaves room for chat and a
// longer session or two inside the plan.
//
// Pure functions: no Stripe, no Supabase. The routes and pages fetch; this
// decides.

import { MONTHLY_MINUTES, isValidQuotaMinutes, quotaState, monthStart } from './usageQuota.js';

export const MINUTES_PER_SESSION = 100;

// A new account's free trial: once per person, not per month. Granted by the
// database function claim_free_trial (migration 027), which is where the
// anti-abuse rules live — one trial per normalised email, none for throwaway
// mail domains, and a cap on new trials a day, so a script registering
// accounts can cost at most a few dollars a day. See freeTrial.js.
export const FREE_TRIAL_MINUTES = 30;

export const PLANS = {
  starter:   { id: 'starter',   name: 'Starter',   priceEur: 9,  sessions: 4,  minutes: 400,  envPrice: 'STRIPE_PRICE_STARTER' },
  pro:       { id: 'pro',       name: 'Pro',       priceEur: 19, sessions: 12, minutes: 1200, envPrice: 'STRIPE_PRICE_PRO' },
  intensive: { id: 'intensive', name: 'Intensive', priceEur: 29, sessions: 25, minutes: 2500, envPrice: 'STRIPE_PRICE_INTENSIVE' },
};

export const PLAN_ORDER = ['starter', 'pro', 'intensive'];

export function isPlan(id) {
  return typeof id === 'string' && Object.hasOwn(PLANS, id);
}

// Statuses that keep the minutes on. past_due is in on purpose: Stripe retries
// a failed card for about two weeks, and a bounced payment should not stop a
// session that week. Only when the retries run out does Stripe move the
// subscription to canceled (or unpaid), and the allowance goes to zero.
// A subscription cancelled "at period end" stays active until that end.
export const GRANTING_STATUSES = ['active', 'trialing', 'past_due'];

export function subscriptionGrants(sub) {
  return !!sub && GRANTING_STATUSES.includes(sub.status) && isPlan(sub.plan);
}

// The plan the client asks for is turned into a price here, on the server. The
// client never sends a price id: it could name any price in the account.
export function priceIdFor(plan, env = process.env) {
  if (!isPlan(plan)) return null;
  return env[PLANS[plan].envPrice] || null;
}

export function planForPriceId(priceId, env = process.env) {
  if (!priceId) return null;
  return PLAN_ORDER.find(p => env[PLANS[p].envPrice] === priceId) ?? null;
}

const iso = (unixSeconds) => (Number.isFinite(unixSeconds) ? new Date(unixSeconds * 1000).toISOString() : null);

// A Stripe Subscription object, as the row the webhook writes. Since Stripe's
// 2025 API versions the billing period lives on the subscription item, not the
// subscription; both places are read so either version works.
export function subscriptionRow(sub, userId, env = process.env) {
  const item = sub?.items?.data?.[0];
  const customer = typeof sub?.customer === 'string' ? sub.customer : sub?.customer?.id;
  return {
    user_id: userId,
    stripe_customer_id: customer,
    stripe_subscription_id: sub.id,
    plan: planForPriceId(item?.price?.id, env),
    status: sub.status,
    cancel_at_period_end: !!sub.cancel_at_period_end || Number.isFinite(sub.cancel_at),
    current_period_start: iso(item?.current_period_start ?? sub.current_period_start),
    current_period_end:   iso(item?.current_period_end   ?? sub.current_period_end),
    updated_at: new Date().toISOString(),
  };
}

// Whether an incoming row may replace the stored one. Events for an old,
// cancelled subscription can arrive after the customer has a new active one;
// letting the old one win would take away minutes they are paying for.
export function shouldReplace(existing, incoming) {
  if (!existing?.stripe_subscription_id) return true;
  if (existing.stripe_subscription_id === incoming.stripe_subscription_id) return true;
  return !(subscriptionGrants(existing) && !subscriptionGrants(incoming));
}

// Where this account's minutes come from, in order:
//   1. its own row in user_quota (migration 025) — set by an admin, for the
//      owner's and test accounts; it beats any plan;
//   2. an active subscription's plan;
//   3. a free trial (one per person, counted from when it was granted);
//   4. nothing: zero minutes.
// When a read failed, the answer is the old default rather than zero: a broken
// query must not lock someone out of recording (see usageLedger.js).
export function resolveAllowance({ quotaRow = null, subscription = null, trialRow = null, readFailed = false, now = new Date() } = {}) {
  const grants = subscriptionGrants(subscription);
  const period = grants && subscription.current_period_start
    ? { periodStart: subscription.current_period_start, periodEnd: subscription.current_period_end ?? null }
    : { periodStart: monthStart(now), periodEnd: null };
  const plan = grants ? subscription.plan : null;

  if (quotaRow && isValidQuotaMinutes(quotaRow.monthly_minutes)) {
    return { minutes: quotaRow.monthly_minutes, source: 'override', plan, ...period };
  }
  if (grants) return { minutes: PLANS[plan].minutes, source: 'plan', plan, ...period };
  if (trialRow?.granted_at && isValidQuotaMinutes(trialRow.minutes)) {
    // Never renews: everything spent since it was granted counts against it.
    return { minutes: trialRow.minutes, source: 'trial', plan: null, periodStart: trialRow.granted_at, periodEnd: null };
  }
  if (readFailed) return { minutes: MONTHLY_MINUTES, source: 'fallback', plan: null, ...period };
  return { minutes: 0, source: 'none', plan: null, ...period };
}

// ok / warn / blocked for an allowance and what has been spent in its period.
// An account with no plan is blocked outright — the overdraft in quotaState is
// for finishing a session that started inside the allowance, not for using the
// app without one.
export function allowanceStatus(allowance, usedMinutes) {
  const state = quotaState({ usedMinutes, quotaMinutes: allowance.minutes });
  if (allowance.source === 'none') return { ...state, status: 'blocked', reason: 'no_plan' };
  if (state.status !== 'blocked') return { ...state, reason: null };
  return { ...state, reason: allowance.source === 'trial' ? 'trial_used' : 'limit' };
}

// Whether a NEW recording may start. The overdraft in quotaState lets a
// session that began inside the allowance finish (and be analysed); it is not
// a second, smaller allowance. On a paid plan that slack is harmless, but a
// free trial that is used up must stop here, or every trial is 45 minutes.
export function mayStartRecording(quota) {
  if (!quota) return { ok: true, reason: null };
  if (quota.status === 'blocked') return { ok: false, reason: quota.reason || 'limit' };
  if (quota.allowance?.source === 'trial' && !(quota.remaining > 0)) return { ok: false, reason: 'trial_used' };
  return { ok: true, reason: null };
}

export function sessionsFromMinutes(minutes) {
  return Math.max(0, minutes) / MINUTES_PER_SESSION;
}

export const NO_PLAN_MESSAGE =
  'Choose a plan on the Billing page to record and analyse sessions.';
export const LIMIT_MESSAGE =
  'You’ve used all sessions this period. Upgrade your plan on the Billing page, or wait until it renews.';

export const TRIAL_USED_MESSAGE =
  `You’ve used your free ${FREE_TRIAL_MINUTES} minutes. Choose a plan on the Billing page to keep recording.`;
export const TRIAL_IMPORT_MESSAGE =
  'Uploading recordings is part of the paid plans. You can record a session live with your free minutes.';

export function blockedMessage(reason) {
  if (reason === 'no_plan') return NO_PLAN_MESSAGE;
  if (reason === 'trial_used') return TRIAL_USED_MESSAGE;
  if (reason === 'trial_import') return TRIAL_IMPORT_MESSAGE;
  return LIMIT_MESSAGE;
}
