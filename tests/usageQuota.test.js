// The number the user actually sees, and what happens when it runs out.
//
// One currency: everything the account spends — audio and all three Claude
// calls — is converted from dollars into minutes at a single rate. The limit is
// soft on purpose. A recording's length is unknown until it ends, so the only
// honest choice is to check before it starts and let a session that is already
// running finish; cutting a therapy session off mid-sentence is not an option.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  minutesFromCost, quotaState, monthStart,
  MONTHLY_MINUTES, WARN_AT_FRACTION, OVERDRAFT_MINUTES,
} from '../src/lib/usageQuota.js';

// ── dollars to minutes ───────────────────────────────────────────────────────

test('cost converts to minutes at the configured rate', () => {
  assert.equal(minutesFromCost(1.00, 0.01), 100);
  assert.equal(minutesFromCost(0, 0.01), 0);
});

test('a broken rate yields zero minutes rather than Infinity', () => {
  // A zero or missing rate is a misconfiguration. Reporting Infinity minutes
  // used would block every account at once; reporting zero fails open, which is
  // the safer direction for a bug in a limit nobody has audited yet.
  assert.equal(minutesFromCost(5, 0), 0);
  assert.equal(minutesFromCost(5, null), 0);
  assert.equal(minutesFromCost(null, 0.01), 0);
});

// ── the soft limit ───────────────────────────────────────────────────────────

const state = (usedMinutes, quota = 100) => quotaState({ usedMinutes, quotaMinutes: quota });

test('plenty left is simply ok', () => {
  const s = state(10);
  assert.equal(s.status, 'ok');
  assert.equal(s.remaining, 90);
});

test('the warning arrives before the minutes do run out', () => {
  // At the threshold there is still real headroom — a warning that fires at zero
  // is not a warning.
  const s = state(100 - 100 * WARN_AT_FRACTION);
  assert.equal(s.status, 'warn');
  assert.ok(s.remaining > 0, 'warning while there is still something left');
});

test('crossing zero warns but does not yet block', () => {
  // The overdraft exists so a session started with four minutes left is not
  // punished for running ninety.
  const s = state(105);
  assert.equal(s.status, 'warn');
  assert.equal(s.remaining, -5);
});

test('blocking starts only past the overdraft', () => {
  assert.equal(state(100 + OVERDRAFT_MINUTES).status, 'warn', 'exactly at the edge is still allowed');
  assert.equal(state(100 + OVERDRAFT_MINUTES + 1).status, 'blocked');
});

test('remaining is reported honestly when negative', () => {
  assert.equal(state(130).remaining, -30, 'the overdraft is shown, not clamped to zero');
});

test('a quota of zero blocks once the overdraft is gone', () => {
  assert.equal(quotaState({ usedMinutes: 0, quotaMinutes: 0 }).status, 'warn');
  assert.equal(quotaState({ usedMinutes: OVERDRAFT_MINUTES + 1, quotaMinutes: 0 }).status, 'blocked');
});

test('nonsense input does not block the account', () => {
  // Failing open matters here: a ledger read that returns junk must not lock a
  // paying user out of their own therapy notes.
  assert.equal(quotaState({ usedMinutes: NaN, quotaMinutes: 100 }).status, 'ok');
  assert.equal(quotaState({}).status, 'ok');
});

test('the default quota is a real number of minutes', () => {
  assert.ok(Number.isFinite(MONTHLY_MINUTES) && MONTHLY_MINUTES > 0);
});

// ── the billing period ───────────────────────────────────────────────────────

test('the month starts at midnight UTC on the first', () => {
  // The ledger is summed from this instant, so it has to be stable across
  // timezones — otherwise the remaining balance changes as the user travels.
  assert.equal(monthStart(new Date('2026-09-10T16:45:00Z')), '2026-09-01T00:00:00.000Z');
  assert.equal(monthStart(new Date('2026-01-01T00:00:00Z')), '2026-01-01T00:00:00.000Z');
  assert.equal(monthStart(new Date('2026-12-31T23:59:59Z')), '2026-12-01T00:00:00.000Z');
});
