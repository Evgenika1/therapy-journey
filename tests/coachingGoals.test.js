// Goals are what make a coaching analysis more than a one-off summary: each
// session is read against the goals the previous one left. Which session counts
// as "previous" is the part that can go quietly wrong, so it is pinned here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GOAL_STATUSES, OPEN_GOAL_STATUSES, GOAL_STATUS_LABELS, MAX_CURRENT_GOALS,
  normalizeGoals, previousGoals, currentGoals,
} from '../src/lib/coachingGoals.js';

const goal = (g, status = 'in_progress', progress = '') => ({ goal: g, status, progress });
const session = (id, date, kind, goals, extra = {}) => ({
  id, created_at: `${date}T10:00:00Z`, kind,
  ai_analysis: goals === undefined ? null : JSON.stringify({ goals }),
  ...extra,
});

test('statuses and labels are fixed', () => {
  assert.deepEqual(GOAL_STATUSES, ['new', 'in_progress', 'changed', 'achieved', 'dropped']);
  assert.deepEqual(OPEN_GOAL_STATUSES, ['new', 'in_progress', 'changed']);
  assert.equal(GOAL_STATUS_LABELS.dropped, 'Set aside');
  assert.equal(MAX_CURRENT_GOALS, 5);
});

test('goals are cleaned: blanks dropped, unknown status becomes in progress', () => {
  assert.deepEqual(normalizeGoals([
    goal('  Launch the course  ', 'new', ' outline drafted '),
    { goal: '   ' }, null, { status: 'new' },
    { goal: 'Run twice a week', status: 'done?' },
  ]), [
    { goal: 'Launch the course', status: 'new', progress: 'outline drafted' },
    { goal: 'Run twice a week', status: 'in_progress', progress: '' },
  ]);
  assert.deepEqual(normalizeGoals('nope'), []);
});

test('no earlier coaching session means no previous goals', () => {
  const current = session('now', '2026-09-14', 'coaching');
  assert.deepEqual(previousGoals([current], current), []);
});

test('the latest earlier analysed coaching session supplies the goals', () => {
  const older  = session('a', '2026-08-01', 'coaching', [goal('Old goal')]);
  const recent = session('b', '2026-09-01', 'coaching', [goal('Recent goal')]);
  const current = session('c', '2026-09-14', 'coaching');
  assert.deepEqual(previousGoals([current, older, recent], current).map(g => g.goal), ['Recent goal']);
});

test('an unanalysed coaching session is skipped for the one before it', () => {
  const analysed   = session('a', '2026-08-01', 'coaching', [goal('Kept goal')]);
  const unanalysed = session('b', '2026-09-01', 'coaching');
  const current    = session('c', '2026-09-14', 'coaching');
  assert.deepEqual(previousGoals([analysed, unanalysed, current], current).map(g => g.goal), ['Kept goal']);
});

test('a therapy session in between does not count', () => {
  const coaching = session('a', '2026-08-01', 'coaching', [goal('Coaching goal')]);
  const therapy  = session('b', '2026-09-01', 'therapy', [goal('Should never appear')]);
  const current  = session('c', '2026-09-14', 'coaching');
  assert.deepEqual(previousGoals([coaching, therapy, current], current).map(g => g.goal), ['Coaching goal']);
});

test('a legacy session without a kind is therapy, so it does not count', () => {
  const legacy  = { id: 'a', created_at: '2026-09-01T10:00:00Z', ai_analysis: JSON.stringify({ goals: [goal('x')] }) };
  const current = session('c', '2026-09-14', 'coaching');
  assert.deepEqual(previousGoals([legacy, current], current), []);
});

test('deleted sessions and later sessions do not count', () => {
  const deleted = session('a', '2026-09-01', 'coaching', [goal('Deleted')], { deleted_at: '2026-09-02T00:00:00Z' });
  const later   = session('b', '2026-09-20', 'coaching', [goal('Later')]);
  const current = session('c', '2026-09-14', 'coaching');
  assert.deepEqual(previousGoals([deleted, later, current], current), []);
});

test('broken analysis JSON is skipped, not thrown', () => {
  const good    = session('a', '2026-08-01', 'coaching', [goal('Good')]);
  const broken  = { ...session('b', '2026-09-01', 'coaching'), ai_analysis: '{"goals": [' };
  const current = session('c', '2026-09-14', 'coaching');
  assert.deepEqual(previousGoals([good, broken, current], current).map(g => g.goal), ['Good']);
});

test('closed goals are still passed to the next analysis', () => {
  const prev = session('a', '2026-09-01', 'coaching', [goal('Done', 'achieved'), goal('Parked', 'dropped')]);
  const current = session('c', '2026-09-14', 'coaching');
  assert.deepEqual(previousGoals([prev, current], current).map(g => g.status), ['achieved', 'dropped']);
});

test('current goals: none without an analysed coaching session', () => {
  assert.equal(currentGoals([]), null);
  assert.equal(currentGoals([session('a', '2026-09-01', 'therapy', [goal('x')])]), null);
  assert.equal(currentGoals([session('a', '2026-09-01', 'coaching')]), null);
});

test('current goals hide achieved and set-aside goals and stop at five', () => {
  const goals = [
    goal('One', 'new'), goal('Two', 'achieved'), goal('Three', 'in_progress'), goal('Four', 'dropped'),
    goal('Five', 'changed'), goal('Six'), goal('Seven'), goal('Eight'),
  ];
  const latest = session('b', '2026-09-10', 'coaching', goals);
  const result = currentGoals([session('a', '2026-09-01', 'coaching', [goal('Old')]), latest]);
  assert.equal(result.session.id, 'b');
  assert.deepEqual(result.goals.map(g => g.goal), ['One', 'Three', 'Five', 'Six', 'Seven']);
});
