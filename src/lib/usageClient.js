import { minutesFromCost, quotaState, monthStart } from './usageQuota.js';

// Reading the ledger from the browser.
//
// No API route: row-level security already restricts usage_events to the
// caller's own rows (and, for an admin, to everyone's), so a route would be a
// second copy of a rule the database is enforcing anyway — and a second place
// for that rule to be got wrong.

// This account's month: what it cost us, what that is in minutes, and whether
// they are ok / warned / blocked.
export async function myUsage(supabase, { now = new Date() } = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('usage_events')
    .select('cost_usd')
    .eq('user_id', user.id)
    .gte('created_at', monthStart(now));
  if (error) throw error;

  const costUsd = (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd || 0), 0);
  const usedMinutes = minutesFromCost(costUsd);
  return { costUsd, usedMinutes, ...quotaState({ usedMinutes }) };
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

  return [...byUser.values()]
    .map(u => ({ ...u, usedMinutes: minutesFromCost(u.costUsd), ...quotaState({ usedMinutes: minutesFromCost(u.costUsd) }) }))
    .sort((a, b) => b.costUsd - a.costUsd);
}
