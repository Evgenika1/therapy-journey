import { claudeCost, audioCost } from './usagePricing.js';
import { minutesFromCost, quotaState, monthStart } from './usageQuota.js';

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

// This month's spend for one account, in dollars and in minutes, plus whether
// they are ok / warned / blocked. Used by the routes to gate, and by the
// dashboard to show the number.
export async function usageThisMonth(supabase, userId, { now = new Date() } = {}) {
  try {
    const { data, error } = await supabase
      .from('usage_events')
      .select('cost_usd')
      .eq('user_id', userId)
      .gte('created_at', monthStart(now));
    if (error) throw error;

    const costUsd = (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd || 0), 0);
    const usedMinutes = minutesFromCost(costUsd);
    return { costUsd, usedMinutes, ...quotaState({ usedMinutes }) };
  } catch (e) {
    // Fail open — see the note at the top of the file.
    console.error('[usage] could not read the month:', e?.message);
    return { costUsd: 0, usedMinutes: 0, ...quotaState({ usedMinutes: 0 }) };
  }
}
