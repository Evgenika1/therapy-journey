// The dashboard charts read from two shapes the app already stores, and both
// have edges that only show up on particular days — a week that starts on a
// Sunday, a log with no intensity, a session that never recorded a mood after.
// Those are the cases pinned here; the SVG itself is looked at in the browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  moodTrendPoints, heatmapGrid, heatmapDaysWithData, mondayOf, levelFor,
  HEATMAP_WEEKS, MIN_TREND_POINTS,
} from '../src/lib/chartData.js';

// ── mood trend ───────────────────────────────────────────────────────────────

test('trend points come back oldest first, whatever order they arrived in', () => {
  // moodPairs is newest-first, which is the order Session Impact wants and the
  // exact reverse of what a time axis needs.
  const pts = moodTrendPoints([
    { id: 3, day: '2026-03-01', before: 4, after: 7 },
    { id: 1, day: '2026-01-15', before: 2, after: 5 },
    { id: 2, day: '2026-02-10', before: 3, after: 4 },
  ]);
  assert.deepEqual(pts.map(p => p.day), ['2026-01-15', '2026-02-10', '2026-03-01']);
});

test('a session missing either end of the mood pair is dropped, not drawn at zero', () => {
  const pts = moodTrendPoints([
    { id: 1, day: '2026-01-01', before: 3, after: 6 },
    { id: 2, day: '2026-01-02', before: 4, after: null },
    { id: 3, day: '2026-01-03', before: undefined, after: 8 },
    { id: 4, day: null,         before: 2, after: 9 },
  ]);
  assert.deepEqual(pts.map(p => p.id), [1], 'only the complete pair survives');
});

test('diff is derived, so a stored diff can never disagree with the line', () => {
  const [p] = moodTrendPoints([{ id: 1, day: '2026-01-01', before: 3, after: 8, diff: 999 }]);
  assert.equal(p.diff, 5);
});

test('a mood of 0 is a real reading, not a missing one', () => {
  const pts = moodTrendPoints([{ id: 1, day: '2026-01-01', before: 0, after: 4 }]);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].before, 0);
});

test('empty and malformed input give an empty list rather than throwing', () => {
  for (const input of [[], null, undefined, 'nope', [null, {}]]) {
    assert.deepEqual(moodTrendPoints(input), []);
  }
});

// ── heatmap grid ─────────────────────────────────────────────────────────────

const at = (iso) => new Date(`${iso}T12:00:00`);

test('the grid is 8 weeks of 7 days, Monday first', () => {
  const cols = heatmapGrid([], at('2026-09-04'));
  assert.equal(cols.length, HEATMAP_WEEKS);
  assert.ok(cols.every(c => c.length === 7));
  // Every column starts on a Monday.
  for (const col of cols) {
    assert.equal(new Date(`${col[0].date}T12:00:00`).getDay(), 1, `${col[0].date} is not a Monday`);
  }
});

test('a Sunday still lands in the week that started the Monday before it', () => {
  // The off-by-one that a Sunday-start week would introduce: 2026-09-06 is a
  // Sunday and belongs with the Monday of 2026-08-31, not with the next week.
  assert.equal(mondayOf(at('2026-09-06')).getDate(), 31);
  const cols = heatmapGrid([], at('2026-09-06'));
  assert.equal(cols[cols.length - 1][0].date, '2026-08-31');
  assert.equal(cols[cols.length - 1][6].date, '2026-09-06');
});

test('the last column contains today, and days after today are marked future', () => {
  const cols = heatmapGrid([], at('2026-09-04'));      // a Friday
  const last = cols[cols.length - 1];
  const today = last.find(c => c.date === '2026-09-04');
  assert.ok(today, 'today is in the last column');
  assert.equal(today.future, false);
  assert.deepEqual(last.filter(c => c.future).map(c => c.date), ['2026-09-05', '2026-09-06']);
});

test('logs land on their own day and carry count, mean and categories', () => {
  const cols = heatmapGrid([
    { created_at: '2026-09-02T08:00:00Z', intensity: 8, category: 'Anxiety' },
    { created_at: '2026-09-02T20:00:00Z', intensity: 6, category: 'Joy' },
    { created_at: '2026-09-03T09:00:00Z', intensity: 2, category: 'Calm' },
  ], at('2026-09-04'));

  const cell = d => cols.flat().find(c => c.date === d);
  assert.equal(cell('2026-09-02').count, 2);
  assert.equal(cell('2026-09-02').mean, 7);
  assert.deepEqual(cell('2026-09-02').categories, ['Anxiety', 'Joy']);
  assert.equal(cell('2026-09-03').mean, 2);
  assert.equal(cell('2026-09-01').count, 0, 'a day with no log stays empty');
});

test('a log with no intensity still marks the day as used', () => {
  // Losing the day entirely would under-report how often the user checked in,
  // which is the one thing the map is meant to show.
  const cols = heatmapGrid(
    [{ created_at: '2026-09-02T08:00:00Z', category: 'Numb' }], at('2026-09-04'));
  const cell = cols.flat().find(c => c.date === '2026-09-02');
  assert.equal(cell.count, 1);
  assert.equal(cell.mean, null, 'it cannot move a mean it never had');
  assert.ok(cell.level > 0, 'but it is not painted as an empty day');
});

test('an unrated log does not drag the mean of a rated one down', () => {
  const cols = heatmapGrid([
    { created_at: '2026-09-02T08:00:00Z', intensity: 8 },
    { created_at: '2026-09-02T09:00:00Z' },
  ], at('2026-09-04'));
  assert.equal(cols.flat().find(c => c.date === '2026-09-02').mean, 8);
});

test('logs older than the window are ignored rather than piling onto week one', () => {
  const cols = heatmapGrid([
    { created_at: '2020-01-01T08:00:00Z', intensity: 9 },
  ], at('2026-09-04'));
  assert.equal(heatmapDaysWithData(cols), 0);
});

test('levels climb with intensity and stop at four', () => {
  assert.deepEqual([0, 1, 3, 4, 5, 6, 7, 8, 10].map(levelFor), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(levelFor(null), 0);
  assert.equal(levelFor(NaN), 0);
});

test('days-with-data counts days, not logs', () => {
  const cols = heatmapGrid([
    { created_at: '2026-09-02T08:00:00Z', intensity: 5 },
    { created_at: '2026-09-02T09:00:00Z', intensity: 5 },
    { created_at: '2026-09-03T09:00:00Z', intensity: 5 },
  ], at('2026-09-04'));
  assert.equal(heatmapDaysWithData(cols), 2);
  assert.ok(heatmapDaysWithData(cols) < MIN_TREND_POINTS, 'still too thin to chart');
});

test('malformed emotion rows do not break the grid', () => {
  for (const input of [null, undefined, 'nope', [null, {}, { created_at: 42 }]]) {
    const cols = heatmapGrid(input, at('2026-09-04'));
    assert.equal(cols.length, HEATMAP_WEEKS);
    assert.equal(heatmapDaysWithData(cols), 0);
  }
});
