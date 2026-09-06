// Re-analysing a session proposes a fresh set of practices. The danger is at
// both ends: doubling the list, or deleting a task the user has already done.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  proposedTasks, reconcileHomework, normalizeTitle, describeTask,
} from '../src/lib/sessionHomework.js';

const row = (id, title, completed = false) => ({ id, title, completed });

// ── reading the analysis ─────────────────────────────────────────────────────

test('practices come back as task + context', () => {
  const out = proposedTasks({ homework: [
    { task: 'Notice the urge to smooth things over', context: 'you spoke about avoiding conflict' },
  ]});
  assert.deepEqual(out, [{
    task: 'Notice the urge to smooth things over',
    context: 'you spoke about avoiding conflict',
  }]);
});

test('a blank or missing task is dropped, never saved as an empty row', () => {
  const out = proposedTasks({ homework: [
    { task: '   ', context: 'x' }, { context: 'no task' }, null, { task: 'real one', context: '' },
  ]});
  assert.deepEqual(out.map(x => x.task), ['real one']);
});

test('an older string-shaped item still reads, without a context', () => {
  // Analyses from before this field carried plain strings.
  const out = proposedTasks({ homework: ['journal each evening'] });
  assert.deepEqual(out, [{ task: 'journal each evening', context: '' }]);
});

test('a missing or malformed homework field gives an empty list', () => {
  for (const a of [null, undefined, {}, { homework: null }, { homework: 'nope' }]) {
    assert.deepEqual(proposedTasks(a), []);
  }
});

// ── re-analysing ─────────────────────────────────────────────────────────────

test('the first run inserts everything and deletes nothing', () => {
  const { toInsert, toDelete } = reconcileHomework([], [{ task: 'a' }, { task: 'b' }]);
  assert.deepEqual(toInsert.map(t => t.task), ['a', 'b']);
  assert.deepEqual(toDelete, []);
});

test('re-analysing the same session does not duplicate a task', () => {
  // The reported behaviour to avoid: press Analyse twice, get two of each.
  const existing = [row(1, 'Notice the urge'), row(2, 'Write to your mother')];
  const { toInsert, toDelete } = reconcileHomework(existing, [
    { task: 'Notice the urge' }, { task: 'Write to your mother' },
  ]);
  assert.deepEqual(toInsert, []);
  assert.deepEqual(toDelete, []);
});

test('near-identical wording counts as the same task', () => {
  // The model rarely returns a character-identical string twice.
  const existing = [row(1, 'Notice the urge to smooth things over.')];
  const { toInsert } = reconcileHomework(existing, [
    { task: 'notice the urge to smooth things over' },
  ]);
  assert.deepEqual(toInsert, [], 'punctuation and case must not make a second row');
});

test('a completed task is never deleted, even once it stops being proposed', () => {
  // It is a record that the user did something. No re-analysis is worth that.
  const existing = [row(1, 'Old but done', true), row(2, 'Old and pending', false)];
  const { toDelete, kept } = reconcileHomework(existing, [{ task: 'Something new' }]);
  assert.deepEqual(toDelete, [2], 'only the stale incomplete one goes');
  assert.deepEqual(kept.map(r => r.id), [1]);
});

test('a stale suggestion is replaced rather than piled on', () => {
  const existing = [row(1, 'No longer relevant')];
  const { toInsert, toDelete } = reconcileHomework(existing, [{ task: 'The new one' }]);
  assert.deepEqual(toInsert.map(t => t.task), ['The new one']);
  assert.deepEqual(toDelete, [1]);
});

test('normalizeTitle ignores case, punctuation and spacing', () => {
  assert.equal(normalizeTitle('Notice  the URGE!'), normalizeTitle('notice the urge'));
  assert.equal(normalizeTitle('Заметь — порыв.'), normalizeTitle('заметь порыв'));
});

test('malformed stored rows do not break the reconciliation', () => {
  const { toInsert, toDelete } = reconcileHomework([null, undefined, {}], [{ task: 'a' }]);
  assert.deepEqual(toInsert.map(t => t.task), ['a']);
  assert.deepEqual(toDelete, [], 'a row with no id contributes nothing to delete');
});

// ── the stored description ───────────────────────────────────────────────────

test('the description keeps the reason and the session it came from', () => {
  const d = describeTask({ task: 't', context: 'you spoke about X' }, 'Sep 4 Session');
  assert.match(d, /you spoke about X/);
  assert.match(d, /From "Sep 4 Session"/);
});

test('a task with no context still records where it came from', () => {
  assert.equal(describeTask({ task: 't', context: '' }, 'Sep 4 Session'), 'From "Sep 4 Session"');
  assert.equal(describeTask({ task: 't', context: '' }, null), 'From a session');
});
