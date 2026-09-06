// Topics are prefilled into a session's notes at the moment recording starts,
// which is the one place this can go wrong destructively: notes the user has
// already begun typing must survive it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pendingTopics, discussedTopics, topicsToNotes, prefillNotes,
} from '../src/lib/sessionTopics.js';
import { aiTopics, reconcileTopics } from '../src/lib/sessionTopics.js';

const t = (text, checked = false) => ({ id: text, text, checked });

test('only unchecked topics are pending', () => {
  const list = [t('boundaries'), t('mum', true), t('sleep')];
  assert.deepEqual(pendingTopics(list).map(x => x.text), ['boundaries', 'sleep']);
  assert.deepEqual(discussedTopics(list).map(x => x.text), ['mum']);
});

test('blank and malformed topics never reach the notes', () => {
  const list = [t('real'), t('   '), t(''), null, { checked: false }, { text: 42, checked: false }];
  assert.deepEqual(pendingTopics(list).map(x => x.text), ['real']);
});

test('the notes block is a heading plus bullets', () => {
  assert.equal(
    topicsToNotes([t('boundaries with mum'), t('why I avoid conflict')]),
    'To discuss:\n• boundaries with mum\n• why I avoid conflict',
  );
});

test('the heading exists so the user\'s own first line is not read as a topic', () => {
  // Without it, everything in the field looks like one undifferentiated list.
  assert.ok(topicsToNotes([t('one')]).startsWith('To discuss:\n'));
});

test('topic text is trimmed into the bullet', () => {
  assert.equal(topicsToNotes([t('  spaced out  ')]), 'To discuss:\n• spaced out');
});

test('nothing pending means no block at all, not an empty heading', () => {
  assert.equal(topicsToNotes([]), '');
  assert.equal(topicsToNotes([t('done', true)]), '');
  assert.equal(topicsToNotes(null), '');
});

test('notes the user has already written are never overwritten', () => {
  // The destructive case: there is no undo on a textarea mid-sentence.
  const typed = 'I want to talk about the argument on Tuesday';
  assert.equal(prefillNotes(typed, [t('something else')]), typed);
});

test('whitespace-only notes still count as empty and get the prefill', () => {
  assert.equal(prefillNotes('   \n  ', [t('boundaries')]), 'To discuss:\n• boundaries');
  assert.equal(prefillNotes('', [t('boundaries')]), 'To discuss:\n• boundaries');
  assert.equal(prefillNotes(undefined, [t('boundaries')]), 'To discuss:\n• boundaries');
});

test('an empty field with no topics stays empty', () => {
  assert.equal(prefillNotes('', []), '');
});

// ── topics proposed by the analysis ──────────────────────────────────────────

const topicRow = (id, text, checked = false) => ({ id, text, checked });

test('for_next_session becomes one topic per item', () => {
  assert.deepEqual(
    aiTopics({ for_next_session: ['вернуться к теме матери', 'страх открыться'] }),
    ['вернуться к теме матери', 'страх открыться'],
  );
});

test('a single string is one topic, not a list of characters', () => {
  // Older analyses returned a bare string for this field.
  assert.deepEqual(aiTopics({ for_next_session: 'one deferred thread' }), ['one deferred thread']);
});

test('blank and malformed entries are dropped', () => {
  assert.deepEqual(aiTopics({ for_next_session: ['  ', '', null, 42, 'real'] }), ['real']);
  for (const a of [null, {}, { for_next_session: null }]) assert.deepEqual(aiTopics(a), []);
});

test('re-analysing the same session does not duplicate its topics', () => {
  const existing = [topicRow(1, 'вернуться к теме матери')];
  const { toInsert, toDelete } = reconcileTopics(existing, ['вернуться к теме матери']);
  assert.deepEqual(toInsert, []);
  assert.deepEqual(toDelete, []);
});

test('a topic already ticked off is never deleted', () => {
  // Checking it is the user saying they raised it. A re-run must not undo that.
  const existing = [topicRow(1, 'raised already', true), topicRow(2, 'still pending', false)];
  const { toDelete } = reconcileTopics(existing, ['something else']);
  assert.deepEqual(toDelete, [2]);
});

test('a stale AI topic is replaced, not piled on', () => {
  const { toInsert, toDelete } = reconcileTopics([topicRow(1, 'no longer relevant')], ['the new one']);
  assert.deepEqual(toInsert, ['the new one']);
  assert.deepEqual(toDelete, [1]);
});

test('wording that differs only in case or punctuation is the same topic', () => {
  const { toInsert } = reconcileTopics([topicRow(1, 'Страх открыться.')], ['страх открыться']);
  assert.deepEqual(toInsert, []);
});
