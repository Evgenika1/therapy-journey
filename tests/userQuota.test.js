// Per-account allowances, end to end through the data layer.
//
// The gate that spends money reads this, and the dashboard shows it, so the two
// must agree — and both must fall back to the default rather than locking an
// account out when the quota read fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { usageThisMonth } from '../src/lib/usageLedger.js';
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
  const out = await usageThisMonth(sb, USER);
  assert.equal(out.quota, 12);
  assert.equal(Math.round(out.usedMinutes), 10);
  assert.equal(out.status, 'warn', '10 of 12 minutes is inside the 20% warning band');
});

test('no quota row means the default allowance', async () => {
  const sb = fakeSupabase({ responses: {
    usage_events: { data: [tenMinutes] },
    user_quota: { data: null },
  } });
  const out = await usageThisMonth(sb, USER);
  assert.equal(out.quota, MONTHLY_MINUTES);
  assert.equal(out.status, 'ok');
});

test('a failed quota read falls back to the default instead of locking the account out', async () => {
  const sb = fakeSupabase({ responses: {
    usage_events: { data: [tenMinutes] },
    user_quota: { error: pgError('42P01', 'relation "user_quota" does not exist') },
  } });
  const out = await usageThisMonth(sb, USER);
  assert.equal(out.quota, MONTHLY_MINUTES);
  assert.equal(out.status, 'ok');
});

test('an allowance of zero blocks once past the overdraft, and is not mistaken for missing', async () => {
  const sb = fakeSupabase({ responses: {
    usage_events: { data: [{ cost_usd: (30 * USD_PER_MINUTE).toFixed(6) }] },
    user_quota: { data: { user_id: USER, monthly_minutes: 0 } },
  } });
  const out = await usageThisMonth(sb, USER);
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
  assert.equal(byId.b.quota, MONTHLY_MINUTES, 'an account with no row keeps the default');
  assert.equal(byId.b.status, 'ok');
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
