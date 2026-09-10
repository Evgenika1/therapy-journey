// The number the user sees, and what happens when it runs out.
//
// One currency. Everything the account spends — audio and all three Claude
// calls — is converted from the ledger's dollars into minutes at a single rate,
// so there is one figure on screen rather than four meters nobody reads. The
// honest consequence, worth stating in the UI: a long AI Chat session does move
// the number, even though nothing was recorded.
//
// Nothing here is stored. Remaining minutes are computed from usage_events on
// every read, which means there is no balance column to drift, no race between
// two tabs, and no reconciliation job. It also means a user must not be able to
// delete their own ledger rows — see the RLS policies in migration 022.

import { ASSEMBLYAI_USD_PER_HOUR } from './usagePricing.js';

// The monthly allowance, in minutes. Deliberately a constant rather than a
// per-user column: the design is a flat monthly quota, and a per-user override
// table can be added later without migrating anything, since an absent row
// would simply mean "the default".
//
// 400 comes from arithmetic at the real AssemblyAI rate ($0.23/hour), not from
// a round number. A 60-minute session costs ~68 minutes of allowance — 60 for
// the audio plus ~8 for the analysis that follows it — so:
//
//   4 sessions/month  = 270 min   (+20 chats -> 296)
//   5 sessions/month  = 338 min   (+20 chats -> 364)
//
// 300 was the first guess and is wrong: weekly therapy plus a little chat lands
// at 296, so an ordinary month would end at 99% and the 20% warning would fire
// after the third session. 400 leaves a fifth session, or a talkative month,
// inside the quota.
export const MONTHLY_MINUTES = 400;

// Warn while there is still real headroom. A warning that fires at zero is not
// a warning, it is an obituary.
export const WARN_AT_FRACTION = 0.2;

// How far past the quota an account may go before it is stopped. This exists
// because a recording's length is unknown until it ends: the check can only run
// before it starts, so someone who begins a session with four minutes left will
// legitimately finish ninety minutes over. Cutting a therapy session off
// mid-sentence to save a few cents is not a trade this app makes.
export const OVERDRAFT_MINUTES = 15;

// What one minute of the user's allowance costs us. Anchored to transcription
// because that is what "a minute" means to the person reading it — a minute of
// their session — and transcription is the dominant cost per minute recorded.
export const USD_PER_MINUTE = ASSEMBLYAI_USD_PER_HOUR / 60;

// A zero or missing rate is a misconfiguration, not a user with infinite usage.
// Reporting Infinity would block every account at once, so this fails open:
// zero minutes used, nobody locked out, and the bug stays visible in the admin
// view where the dollar totals are unaffected.
export function minutesFromCost(costUsd, usdPerMinute = USD_PER_MINUTE) {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  if (!Number.isFinite(usdPerMinute) || usdPerMinute <= 0) return 0;
  return costUsd / usdPerMinute;
}

// 'ok' | 'warn' | 'blocked', plus the remaining minutes — reported honestly when
// negative rather than clamped, so the UI can say how far over the account is.
//
// Fails open on nonsense input for the same reason as above: a bad ledger read
// must not lock someone out of their own therapy notes.
export function quotaState({ usedMinutes, quotaMinutes = MONTHLY_MINUTES } = {}) {
  const quota = Number.isFinite(quotaMinutes) && quotaMinutes >= 0 ? quotaMinutes : MONTHLY_MINUTES;
  if (!Number.isFinite(usedMinutes)) return { remaining: quota, used: 0, quota, status: 'ok' };

  const remaining = quota - usedMinutes;
  const status =
    remaining < -OVERDRAFT_MINUTES  ? 'blocked'
    : remaining <= quota * WARN_AT_FRACTION ? 'warn'
    : 'ok';

  return { remaining, used: usedMinutes, quota, status };
}

// The instant the billing period began, as an ISO string to hand to PostgREST.
// Fixed to UTC on purpose: derived from the device clock instead, the remaining
// balance would change as the user travels, and a session recorded on the 1st
// could land in either month depending on where they opened the tab.
export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

// What a blocked account is told. One sentence, no jargon, and it says when the
// limit lifts — "you have run out" without a date is a dead end.
export const BLOCKED_MESSAGE =
  'You have used all of this month\u2019s minutes. Your allowance resets on the 1st.';
