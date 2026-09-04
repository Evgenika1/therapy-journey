// The bug this covers: a date left in the past rendered a 00:00:00 countdown,
// which reads as "the app is broken" rather than "this date is stale". The
// boundary between counting down and having passed is the whole point, so it is
// pinned here at the second rather than discovered by waiting for it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countdownFrom, SESSION_DATE_KEY } from '../src/lib/nextSession.js';

const now = new Date('2026-09-04T12:00:00');

test('no date at all is its own state, not a zeroed countdown', () => {
  for (const value of ['', '   ', null, undefined, 0, {}]) {
    assert.deepEqual(countdownFrom(value, now), { status: 'none' });
  }
});

test('an unparseable stored value is treated as unset, not crashed on', () => {
  // localStorage is hand-editable and survives across builds, so the value can
  // be anything at all by the time it is read back.
  for (const value of ['not a date', '2026-13-45T99:99', 'undefined']) {
    assert.equal(countdownFrom(value, now).status, 'none', `${value} should read as unset`);
  }
});

test('a date in the past reports as past — this is the reported bug', () => {
  const state = countdownFrom('2026-06-24T16:44', now);
  assert.equal(state.status, 'past');
  assert.ok(!('days' in state), 'a past date has no countdown to render');
});

test('a date in the future counts down', () => {
  const state = countdownFrom('2026-09-06T15:30:00', now);
  assert.equal(state.status, 'future');
  assert.equal(state.days, 2);
  assert.equal(state.hours, 3);
  assert.equal(state.mins, 30);
});

test('the boundary: one minute out counts, exactly now and one second late do not', () => {
  assert.equal(countdownFrom('2026-09-04T12:01:00', now).status, 'future');
  assert.equal(countdownFrom('2026-09-04T12:00:00', now).status, 'past', 'the moment itself has arrived');
  assert.equal(countdownFrom('2026-09-04T11:59:59', now).status, 'past');
});

test('units do not bleed into each other', () => {
  // 1 day, 0 hours, 0 mins — the case where a naive modulo shows 24 hours.
  const state = countdownFrom('2026-09-05T12:00:00', now);
  assert.deepEqual([state.days, state.hours, state.mins], [1, 0, 0]);
});

test('under an hour still counts down instead of rounding to nothing', () => {
  const state = countdownFrom('2026-09-04T12:45:00', now);
  assert.deepEqual([state.days, state.hours, state.mins], [0, 0, 45]);
});

test('the storage key is exported so the page and the tests cannot drift apart', () => {
  assert.equal(SESSION_DATE_KEY, 'tj_next_session_date');
});
