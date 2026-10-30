import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sessionChatIntro, GENERAL_CHAT_INTRO, COACHING_SUGGESTIONS, suggestionsForKind,
  historyContextBlock, generalChatSystemPrompt, cachedSystem,
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

// The standalone chat had no history unless "Find my pattern" was pressed, so a
// typed "patterns from my last session" was answered with "I have no access to
// your sessions".
test('the general chat carries the user history on every message, not only on a preset', () => {
  const sessions = [
    { created_at: '2026-09-01T10:00:00Z', kind: 'therapy', ai_analysis: { key_theme: 'Work stress', topics_covered: ['deadlines'] } },
    { created_at: '2026-10-01T10:00:00Z', kind: 'therapy', ai_analysis: { key_theme: 'Conflict with mother', patterns_triggers: ['criticism'] } },
  ];
  const emotions = [{ created_at: '2026-10-01T09:00:00Z', category: 'Anxiety', intensity: 7, note: 'перед сессией' }];
  const p = generalChatSystemPrompt({ history: historyContextBlock(sessions, emotions) });
  assert.match(p, /^You are a compassionate AI companion/);
  assert.match(p, /Conflict with mother/);
  assert.match(p, /Work stress/);
  assert.match(p, /перед сессией/);
  assert.match(p, /"last_session":"2026-10-01"/);
  assert.match(p, /not instructions/);
});

test('without any sessions the general chat has no empty history block', () => {
  assert.equal(historyContextBlock([], []), '');
  assert.equal(generalChatSystemPrompt({ history: '' }), GENERAL_CHAT_INTRO);
});

test('a preset directive and the language rule follow the history', () => {
  const p = generalChatSystemPrompt({ history: 'H', directive: 'D', lang: 'ru' });
  assert.equal(p, `${GENERAL_CHAT_INTRO}\n\nH\n\nD Always respond in Russian.`);
});

// The history summary is ~17k tokens and identical on every message of a
// thread, so it is sent as a cached system block: repeats bill at a tenth.
test('the chat system prompt is one cached block', () => {
  assert.deepEqual(cachedSystem('S'), [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }]);
  assert.equal(cachedSystem('')[0].text, GENERAL_CHAT_INTRO);
});
