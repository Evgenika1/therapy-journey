// Per-account allowances, end to end through the data layer.
//
// The gate that spends money reads this, and the dashboard shows it, so the two
// must agree — and both must fall back to the default rather than locking an
// account out when the quota read fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { usageThisPeriod } from '../src/lib/usageLedger.js';
import { myUsage, allUsage, setUserQuota } from '../src/lib/usageClient.js';
import { MONTHLY_MINUTES, MAX_QUOTA_MINUTES, USD_PER_MINUTE } from '../src/lib/usageQuota.js';
import { fakeSupabase, pgError } from './helpers/fakeSupabase.js';

const USER = 'user-1';
// Ten minutes' worth of spend, in dollars.
const tenMinutes = { cost_usd: (10 * USD_PER_MINUTE).toFixed(6) };

test('the server gate reads the account\'s own allowance', async () => {
  const sb = fakeSupabase({ responses: {
    usage_events: { data: [tenMinutes] },
    user_quota: { data: { user_id: USER, monthly_minutes: 12 } },
  } });
  const out = await usageThisPeriod(sb, USER);
  assert.equal(out.quota, 12);
  assert.equal(Math.round(out.usedMinutes), 10);
  assert.equal(out.status, 'warn', '10 of 12 minutes is inside the 20% warning band');
});

test('no quota row and no subscription means no minutes: there is no free tier', async () => {
  const sb = fakeSupabase({ responses: {
    usage_events: { data: [] },
    user_quota: { data: null },
    subscriptions: { data: null },
  } });
  const out = await usageThisPeriod(sb, USER);
  assert.equal(out.quota, 0);
  assert.equal(out.status, 'blocked');
  assert.equal(out.reason, 'no_plan');
});

test('an active subscription gives its plan\'s minutes, counted from its own period start', async () => {
  const sb = fakeSupabase({ responses: {
    usage_events: { data: [tenMinutes] },
    user_quota: { data: null },
    subscriptions: { data: { plan: 'pro', status: 'active', current_period_start: '2026-11-05T09:00:00.000Z', current_period_end: '2026-12-05T09:00:00.000Z' } },
  } });
  const out = await usageThisPeriod(sb, USER);
  assert.equal(out.quota, 1200);
  assert.equal(out.status, 'ok');
  assert.equal(out.allowance.source, 'plan');
  const ledger = sb.callsFor('usage_events')[0];
  assert.deepEqual(ledger.filters.find(f => f[0] === 'gte'), ['gte', 'created_at', '2026-11-05T09:00:00.000Z']);
});

test('an admin\'s allowance beats the plan', async () => {
  const sb = fakeSupabase({ responses: {
    usage_events: { data: [tenMinutes] },
    user_quota: { data: { user_id: USER, monthly_minutes: 5000 } },
    subscriptions: { data: { plan: 'starter', status: 'active', current_period_start: '2026-11-05T09:00:00.000Z' } },
  } });
  const out = await usageThisPeriod(sb, USER);
  assert.equal(out.quota, 5000);
  assert.equal(out.allowance.source, 'override');
});

test('a cancelled subscription gives nothing', async () => {
  const sb = fakeSupabase({ responses: {
    usage_events: { data: [] },
    user_quota: { data: null },
    subscriptions: { data: { plan: 'pro', status: 'canceled' } },
  } });
  const out = await usageThisPeriod(sb, USER);
  assert.equal(out.status, 'blocked');
  assert.equal(out.reason, 'no_plan');
});

test('a failed allowance read falls back to the default instead of locking the account out', async () => {
  const sb = fakeSupabase({ responses: {
    usage_events: { data: [tenMinutes] },
    user_quota: { data: null },
    subscriptions: { error: pgError('42P01', 'relation "subscriptions" does not exist') },
  } });
  const out = await usageThisPeriod(sb, USER);
  assert.equal(out.quota, MONTHLY_MINUTES);
  assert.equal(out.status, 'ok');
});

test('an allowance of zero blocks once past the overdraft, and is not mistaken for missing', async () => {
  const sb = fakeSupabase({ responses: {
    usage_events: { data: [{ cost_usd: (30 * USD_PER_MINUTE).toFixed(6) }] },
    user_quota: { data: { user_id: USER, monthly_minutes: 0 } },
  } });
  const out = await usageThisPeriod(sb, USER);
  assert.equal(out.quota, 0);
  assert.equal(out.status, 'blocked');
});

test('the dashboard reads the same allowance as the gate', async () => {
  const sb = fakeSupabase({ responses: {
    usage_events: { data: [tenMinutes] },
    user_quota: { data: { user_id: USER, monthly_minutes: 30 } },
  } });
  const out = await myUsage(sb);
  assert.equal(out.quota, 30);
  assert.equal(Math.round(out.remaining), 20);
});

test('the admin view shows each account against its own allowance', async () => {
  const sb = fakeSupabase({ responses: {
    usage_events: { data: [
      { user_id: 'a', kind: 'transcribe', cost_usd: (10 * USD_PER_MINUTE).toFixed(6), created_at: '2026-09-15T10:00:00Z' },
      { user_id: 'b', kind: 'transcribe', cost_usd: (10 * USD_PER_MINUTE).toFixed(6), created_at: '2026-09-15T09:00:00Z' },
    ] },
    user_quota: { data: [{ user_id: 'a', monthly_minutes: 12 }] },
  } });
  const rows = await allUsage(sb);
  const byId = Object.fromEntries(rows.map(r => [r.userId, r]));
  assert.equal(byId.a.quota, 12);
  assert.equal(byId.a.status, 'warn');
  assert.equal(byId.b.quota, 0, 'an account with no row and no plan has no minutes');
  assert.equal(byId.b.status, 'blocked');
});

test('an account with an allowance but no spend still appears, so it can be edited', async () => {
  const sb = fakeSupabase({ responses: {
    usage_events: { data: [] },
    user_quota: { data: [{ user_id: 'quiet', monthly_minutes: 900 }] },
  } });
  const rows = await allUsage(sb);
  assert.deepEqual(rows.map(r => r.userId), ['quiet']);
  assert.equal(rows[0].quota, 900);
  assert.equal(rows[0].costUsd, 0);
  assert.equal(rows[0].usedMinutes, 0);
});

test('saving an allowance writes one row per account', async () => {
  const sb = fakeSupabase({ responses: { user_quota: { data: { user_id: 'b', monthly_minutes: 900 } } } });
  const saved = await setUserQuota(sb, 'b', 900);
  assert.equal(saved.monthly_minutes, 900);
  const call = sb.lastCall();
  assert.equal(call.table, 'user_quota');
  assert.equal(call.op, 'upsert');
  assert.equal(call.payload.user_id, 'b');
  assert.equal(call.payload.monthly_minutes, 900);
  assert.equal(call.upsertOptions?.onConflict, 'user_id');
});

test('an unusable allowance is refused before it reaches the database', async () => {
  const sb = fakeSupabase({ responses: { user_quota: { data: {} } } });
  for (const bad of [-1, 1.5, NaN, '400', null, undefined, MAX_QUOTA_MINUTES + 1]) {
    await assert.rejects(() => setUserQuota(sb, 'b', bad), /whole number|0 and/i, `${JSON.stringify(bad)}`);
  }
  assert.equal(sb.callsFor('user_quota').length, 0, 'nothing may be written');
});

test('saving without an account is refused', async () => {
  const sb = fakeSupabase({ responses: { user_quota: { data: {} } } });
  await assert.rejects(() => setUserQuota(sb, '', 400), /account/i);
});
