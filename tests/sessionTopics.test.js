// Topics are prefilled into a session's notes at the moment recording starts,
// which is the one place this can go wrong destructively: notes the user has
// already begun typing must survive it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pendingTopics, discussedTopics, topicsToNotes, prefillNotes,
} from '../src/lib/sessionTopics.js';

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
