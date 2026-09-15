import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sessionChatIntro, GENERAL_CHAT_INTRO, COACHING_SUGGESTIONS, suggestionsForKind,
} from '../src/lib/chatPrompts.js';
import { CHAT_SUGGESTIONS } from '../src/lib/chatPresets.js';

test('a therapy session chat keeps the therapy companion voice', () => {
  const p = sessionChatIntro({ kind: 'therapy', transcript: 'Мне тревожно.' });
  assert.match(p, /therapy companion/);
  assert.match(p, /reviewing a therapy session/);
  assert.match(p, /"Мне тревожно\."/);
});

test('a coaching session chat is about goals and steps, not feelings', () => {
  const p = sessionChatIntro({ kind: 'coaching', transcript: 'By Friday I will email two clients.' });
  assert.match(p, /coaching companion/);
  assert.match(p, /goals/);
  assert.match(p, /next concrete step/);
  assert.match(p, /reviewing a coaching session/);
  assert.doesNotMatch(p, /therapy companion/);
});

test('without a transcript the intro has no empty transcript block', () => {
  assert.doesNotMatch(sessionChatIntro({ kind: 'coaching' }), /Session transcript/);
  assert.doesNotMatch(sessionChatIntro({ kind: 'therapy', transcript: '  ' }), /Session transcript/);
});

test('the general chat is neutral', () => {
  assert.match(GENERAL_CHAT_INTRO, /therapist or a coach/);
});

test('coaching chats lead with coaching suggestions, therapy keeps its list', () => {
  assert.ok(COACHING_SUGGESTIONS.length >= 2 && COACHING_SUGGESTIONS.length <= 3);
  assert.deepEqual(suggestionsForKind('therapy'), CHAT_SUGGESTIONS);
  assert.deepEqual(suggestionsForKind('coaching').slice(0, COACHING_SUGGESTIONS.length), COACHING_SUGGESTIONS);
  assert.equal(suggestionsForKind('coaching').length, COACHING_SUGGESTIONS.length + CHAT_SUGGESTIONS.length);
});
