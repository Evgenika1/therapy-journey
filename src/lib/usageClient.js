import { minutesFromCost, monthStart, isValidQuotaMinutes, MAX_QUOTA_MINUTES } from './usageQuota.js';
import { usageThisPeriod } from './usageLedger.js';
import { resolveAllowance, allowanceStatus } from './plans.js';

// Reading the ledger from the browser.
//
// No API route: row-level security already restricts usage_events to the
// caller's own rows (and, for an admin, to everyone's), so a route would be a
// second copy of a rule the database is enforcing anyway — and a second place
// for that rule to be got wrong.

// This account's period: what it cost us, what that is in minutes, and whether
// they are ok / warned / blocked. The same function the server gates with, run
// on the browser's own session, so the dashboard and the gate cannot disagree.
export async function myUsage(supabase, { now = new Date() } = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return usageThisPeriod(supabase, user.id, { now });
}

// This account's subscription row, for the Billing page. Null without one.
export async function mySubscription(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('subscriptions')
    .select('plan, status, cancel_at_period_end, current_period_start, current_period_end')
    .eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// Whether the signed-in account is an admin. The policy on `admins` returns
// only your own row, so this is the whole check — a non-admin gets nothing back
// and cannot learn who is on the list.
export async function amIAdmin(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (error) { console.error('[usage] admin check:', error.message); return false; }
  return Boolean(data);
}

// Every account's spend this month, for the admin view. Returns rows already
// grouped by user, newest spend first. RLS is what makes this return more than
// your own rows — if the caller is not an admin, it quietly returns just theirs.
export async function allUsage(supabase, { now = new Date() } = {}) {
  const { data, error } = await supabase
    .from('usage_events')
    .select('user_id, kind, model, cost_usd, audio_seconds, input_tokens, output_tokens, created_at')
    .gte('created_at', monthStart(now))
    .order('created_at', { ascending: false });
  if (error) throw error;

  // Allowances for everyone the admin can see. An account with an allowance but
  // no spend this month still has to appear, or there is no way to edit it back.
  let quotas = [];
  try {
    const { data: qRows, error: qErr } = await supabase.from('user_quota').select('user_id, monthly_minutes');
    if (qErr) throw qErr;
    quotas = qRows ?? [];
  } catch (e) {
    console.error('[usage] could not read quotas:', e?.message);
  }
  const quotaOf = new Map(quotas.map(q => [q.user_id, q]));

  // Subscriptions, for accounts without an override. A failed read is shown as
  // the fallback allowance rather than as everyone being blocked.
  let subs = [], subsFailed = false;
  try {
    const { data: sRows, error: sErr } = await supabase
      .from('subscriptions').select('user_id, plan, status, current_period_start, current_period_end');
    if (sErr) throw sErr;
    subs = sRows ?? [];
  } catch (e) {
    subsFailed = true;
    console.error('[usage] could not read subscriptions:', e?.message);
  }
  const subOf = new Map(subs.map(r => [r.user_id, r]));

  const byUser = new Map();
  for (const row of data ?? []) {
    if (!byUser.has(row.user_id)) {
      byUser.set(row.user_id, {
        userId: row.user_id, costUsd: 0, events: 0, audioSeconds: 0,
        inputTokens: 0, outputTokens: 0,
        byKind: { transcribe: 0, analyze: 0, chat: 0, patterns: 0 },
      });
    }
    const u = byUser.get(row.user_id);
    const cost = Number(row.cost_usd || 0);
    u.costUsd += cost;
    u.events += 1;
    u.audioSeconds  += Number(row.audio_seconds  || 0);
    u.inputTokens   += Number(row.input_tokens   || 0);
    u.outputTokens  += Number(row.output_tokens  || 0);
    if (u.byKind[row.kind] !== undefined) u.byKind[row.kind] += cost;
  }

  for (const [userId] of quotaOf) {
    if (!byUser.has(userId)) {
      byUser.set(userId, {
        userId, costUsd: 0, events: 0, audioSeconds: 0,
        inputTokens: 0, outputTokens: 0,
        byKind: { transcribe: 0, analyze: 0, chat: 0, patterns: 0 },
      });
    }
  }

  return [...byUser.values()]
    .map(u => {
      const usedMinutes = minutesFromCost(u.costUsd);
      // Spend here is this calendar month for everyone, not each account's own
      // billing period: one query for the whole table, and close enough for an
      // overview. The gate itself uses the exact period.
      const allowance = resolveAllowance({
        quotaRow: quotaOf.get(u.userId) ?? null,
        subscription: subOf.get(u.userId) ?? null,
        readFailed: subsFailed, now,
      });
      // hasOwnQuota says whether the number came from an admin's row, so the
      // admin view can show an edited allowance as edited; plan, which one.
      return {
        ...u, usedMinutes, hasOwnQuota: allowance.source === 'override', plan: allowance.plan,
        allowanceSource: allowance.source, ...allowanceStatus(allowance, usedMinutes),
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd);
}

// Set one account's monthly allowance. Admin-only: the policy on user_quota
// refuses the write for anyone else, and this validates first so a typo never
// reaches the database.
export async function setUserQuota(supabase, userId, minutes) {
  if (typeof userId !== 'string' || !userId.trim()) throw new Error('No account to set an allowance for.');
  if (!isValidQuotaMinutes(minutes)) {
    throw new Error(`The allowance must be a whole number of minutes between 0 and ${MAX_QUOTA_MINUTES}.`);
  }
  const { data, error } = await supabase
    .from('user_quota')
    .upsert({ user_id: userId, monthly_minutes: minutes, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ?? { user_id: userId, monthly_minutes: minutes };
}
