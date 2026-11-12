import { claudeCost, audioCost } from './usagePricing.js';
import { minutesFromCost, quotaState, MONTHLY_MINUTES } from './usageQuota.js';
import { resolveAllowance, allowanceStatus, blockedMessage } from './plans.js';

// Writing to and reading from the usage ledger, from inside API routes.
//
// Two rules run through everything here:
//
//   Recording a cost must never fail the user's request. The work is already
//   done and already paid for by the time we get here — losing the ledger row
//   costs us an accounting entry, but failing the response costs the user their
//   session. Every write is best-effort and logs on failure.
//
//   The quota check fails open. If the ledger cannot be read, the account is
//   not blocked. A bug in a limit nobody has audited yet must not lock someone
//   out of their own therapy notes.

// Records one spend. `supabase` is the caller's own session client, so RLS
// enforces that the row can only be written against their own user_id.
export async function recordUsage(supabase, { userId, kind, sessionId = null, model = null, usage = null, audioSeconds = null, externalId = null }) {
  let cost = 0;
  try {
    cost = usage ? claudeCost({ model, ...usage }) : audioCost(audioSeconds);
  } catch (e) {
    // An unpriced model. Record the tokens anyway with a zero cost: the row
    // showing traffic at no charge is how this becomes visible in the admin
    // view, rather than vanishing from the totals unnoticed.
    console.error('[usage] pricing failed:', e?.message, '— recording tokens at zero cost');
  }

  const row = {
    user_id: userId,
    kind,
    session_id: sessionId,
    model,
    audio_seconds: audioSeconds ?? null,
    input_tokens:       usage?.input_tokens ?? null,
    output_tokens:      usage?.output_tokens ?? null,
    cache_read_tokens:  usage?.cache_read_input_tokens ?? null,
    cache_write_tokens: usage?.cache_creation_input_tokens ?? null,
    cost_usd: cost,
    external_id: externalId,
  };

  try {
    const { error } = await supabase.from('usage_events').insert(row);
    if (error) throw error;
  } catch (e) {
    // 23505 is the unique index on (user_id, kind, external_id): this spend was
    // already billed, which is the index doing its job on a re-polled job, not
    // a failure worth shouting about.
    if (e?.code === '23505') return 0;
    console.error('[usage] could not record', kind, 'for', userId, '—', e?.message);
  }
  return cost;
}

// One account's allowance and the period it runs over: its own user_quota row
// (an admin's override) beats the plan of an active subscription, which beats
// nothing — see resolveAllowance in plans.js. Both reads use the caller's own
// session; RLS returns their own rows.
export async function allowanceFor(supabase, userId, { now = new Date() } = {}) {
  let quotaRow = null, subscription = null, readFailed = false;
  const [q, sub] = await Promise.allSettled([
    supabase.from('user_quota').select('monthly_minutes').eq('user_id', userId).maybeSingle(),
    supabase.from('subscriptions')
      .select('plan, status, cancel_at_period_end, current_period_start, current_period_end')
      .eq('user_id', userId).maybeSingle(),
  ]);
  for (const [r, set] of [[q, v => { quotaRow = v; }], [sub, v => { subscription = v; }]]) {
    if (r.status === 'fulfilled' && !r.value.error) set(r.value.data ?? null);
    else {
      // Fail towards the old default, not towards zero: an unreachable table
      // must not lock an account out of recording.
      readFailed = true;
      console.error('[usage] could not read the allowance:', r.reason?.message ?? r.value?.error?.message);
    }
  }
  return resolveAllowance({ quotaRow, subscription, readFailed, now });
}

// This period's spend for one account, in dollars and in minutes, plus whether
// they are ok / warned / blocked and why. The period is the subscription's
// billing period, or the calendar month without one. Used by the routes to
// gate.
export async function usageThisPeriod(supabase, userId, { now = new Date() } = {}) {
  const allowance = await allowanceFor(supabase, userId, { now });
  try {
    const { data, error } = await supabase
      .from('usage_events')
      .select('cost_usd')
      .eq('user_id', userId)
      .gte('created_at', allowance.periodStart);
    if (error) throw error;

    const costUsd = (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd || 0), 0);
    const usedMinutes = minutesFromCost(costUsd);
    return { costUsd, usedMinutes, allowance, ...allowanceStatus(allowance, usedMinutes) };
  } catch (e) {
    // Fail open — see the note at the top of the file.
    console.error('[usage] could not read the period:', e?.message);
    return { costUsd: 0, usedMinutes: 0, allowance, ...quotaState({ usedMinutes: 0, quotaMinutes: allowance.minutes || MONTHLY_MINUTES }), reason: null };
  }
}

// What a route answers when the account may not spend. 402 Payment Required;
// `reason` lets the page offer the right next step.
export function blockedResponseBody(quota) {
  return {
    error: blockedMessage(quota.reason),
    quota: { status: quota.status, remaining: quota.remaining, reason: quota.reason },
  };
}
