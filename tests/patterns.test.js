// Cross-session patterns: what reaches Claude, and when it is allowed to.
//
// Two things decide whether this feature is any good, and neither is visible in
// the UI: the summary must stay small while keeping the signal (a raw history
// here is hours of transcript), and the cache must not quietly serve a stale
// answer after new sessions land.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_ANALYSED_SESSIONS, PATTERNS_SCHEMA, PATTERN_SECTIONS,
  hasAnalysis, analysedSessions, canFindPatterns, buildPatternsInput,
  cacheSignature, isStale, hasAnyPattern,
} from '../src/lib/patternsInput.js';

const analysis = (over = {}) => JSON.stringify({
  topics_covered: ['тревога перед встречей', 'сон'],
  overview: ['Клиент говорил о тревоге.'],
  key_theme: 'страх отвержения',
  breakthroughs: ['осознал паттерн'],
  emotions_identified: ['тревога — перед встречей'],
  action_items: ['вести дневник'],
  patterns_triggers: ['избегание конфликта'],
  continuity_notes: [],
  for_next_session: ['вернуться к теме матери'],
  emotional_intensity_markers: ['слёзы на 40-й минуте'],
  ...over,
});

const session = (day, extra = {}) => ({
  id: `s-${day}`,
  created_at: `2026-0${day}-01T10:00:00Z`,
  ai_analysis: analysis(),
  mood_before: 4, mood_after: 7,
  ...extra,
});

// ── the gate ─────────────────────────────────────────────────────────────────

test('a session counts only once it has been analysed', () => {
  assert.equal(hasAnalysis(session(1)), true);
  assert.equal(hasAnalysis({ id: 'x', transcript: 'много текста', ai_analysis: null }), false);
  assert.equal(hasAnalysis({ id: 'x' }), false);
});

test('an analysis stored as an object counts too, not just a JSON string', () => {
  assert.equal(hasAnalysis({ ai_analysis: { key_theme: 'страх' } }), true);
});

test('unparseable analysis JSON does not count as analysed', () => {
  assert.equal(hasAnalysis({ ai_analysis: '{ this is not json' }), false);
});

test('patterns need three analysed sessions, and bare sessions do not help', () => {
  const bare = [1, 2, 3, 4, 5].map(d => session(d, { ai_analysis: null, transcript: 'текст' }));
  assert.equal(canFindPatterns(bare), false);
  assert.equal(canFindPatterns([session(1), session(2)]), false);
  assert.equal(canFindPatterns([session(1), session(2), session(3)]), true);
  assert.equal(MIN_ANALYSED_SESSIONS, 3);
});

test('the gate survives missing and malformed input', () => {
  assert.equal(canFindPatterns([]), false);
  assert.equal(canFindPatterns(null), false);
  assert.equal(canFindPatterns(undefined), false);
  assert.deepEqual(analysedSessions(null), []);
});

// ── the payload ──────────────────────────────────────────────────────────────

test('history is ordered oldest first so shifts over time are answerable', () => {
  // The app stores and shows sessions newest-first; asking "what changed" from
  // that order is what makes a model invent a direction.
  const input = buildPatternsInput([session(3), session(1), session(2)], []);
  assert.deepEqual(input.sessions.map(s => s.date), ['2026-01-01', '2026-02-01', '2026-03-01']);
  assert.equal(input.first_session, '2026-01-01');
  assert.equal(input.last_session, '2026-03-01');
});

test('counts are carried so the model states real frequencies', () => {
  const list = [session(1), session(2), session(3), session(4, { ai_analysis: null, transcript: 'т' })];
  const input = buildPatternsInput(list, []);
  assert.equal(input.total_sessions, 4);
  assert.equal(input.analysed_sessions, 3);
});

test('the summary carries the analysis fields patterns are built from', () => {
  const [s] = buildPatternsInput([session(1)], []).sessions;
  assert.equal(s.key_theme, 'страх отвержения');
  assert.deepEqual(s.topics, ['тревога перед встречей', 'сон']);
  assert.deepEqual(s.patterns_triggers, ['избегание конфликта']);
  assert.equal(s.mood_before, 4);
  assert.equal(s.mood_after, 7);
});

test('raw transcripts are never sent for analysed sessions', () => {
  // A single session here runs to two hours; sending transcripts would blow the
  // context window and the budget for no added signal.
  const long = 'слово '.repeat(20000);
  const input = buildPatternsInput([session(1, { transcript: long })], []);
  assert.ok(!('excerpt' in input.sessions[0]));
  assert.ok(!JSON.stringify(input).includes(long));
});

test('an unanalysed session contributes a short excerpt rather than nothing', () => {
  const long = 'уникальный текст '.repeat(500);
  const [s] = buildPatternsInput([session(1, { ai_analysis: null, transcript: long })], []).sessions;
  assert.equal(s.analysed, false);
  assert.ok(s.excerpt.length <= 600);
  assert.ok(s.excerpt.startsWith('уникальный текст'));
});

test('a long history is capped instead of growing without limit', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({
    id: `s${i}`, created_at: `2026-01-01T00:${String(i % 60).padStart(2, '0')}:00Z`,
    ai_analysis: analysis(),
  }));
  const input = buildPatternsInput(many, []);
  assert.ok(input.sessions.length <= 60, `sent ${input.sessions.length} sessions`);
  assert.equal(input.total_sessions, 200, 'the real total must still be reported');
});

test('the most recent sessions are the ones kept when capping', () => {
  const many = Array.from({ length: 80 }, (_, i) => ({
    id: `s${i}`, created_at: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`.replace(':80:', ':59:'),
    ai_analysis: analysis(),
  }));
  const input = buildPatternsInput(many, []);
  assert.ok(input.sessions.length <= 60);
  // The last entry sent must be the newest one in the source.
  assert.equal(input.sessions[input.sessions.length - 1].date, '2026-01-01');
});

test('the emotion log travels with dates, intensity and before/after tags', () => {
  const input = buildPatternsInput([session(1)], [
    { created_at: '2026-01-02T09:00:00Z', category: 'Anxiety', sub_emotions: ['worried'], intensity: 8, session_tag: 'before' },
    { created_at: '2026-01-02T11:00:00Z', category: 'Calm', sub_emotions: ['grounded'], intensity: 3, session_tag: 'after' },
  ]);
  assert.equal(input.emotion_log.length, 2);
  assert.deepEqual(input.emotion_log[0], {
    date: '2026-01-02', category: 'Anxiety', emotions: ['worried'], intensity: 8, tag: 'before',
  });
  assert.equal(input.emotion_log[1].tag, 'after');
});

test('building a payload from nothing does not throw', () => {
  const input = buildPatternsInput([], []);
  assert.deepEqual(input.sessions, []);
  assert.equal(input.total_sessions, 0);
  assert.doesNotThrow(() => buildPatternsInput(null, null));
});

// ── cache freshness ──────────────────────────────────────────────────────────

test('a cache built from the same history is fresh', () => {
  const list = [session(1), session(2), session(3)];
  const cached = { signature: cacheSignature(list) };
  assert.equal(isStale(cached, list), false);
});

test('a newly analysed session makes the cache stale', () => {
  const before = [session(1), session(2), session(3)];
  const cached = { signature: cacheSignature(before) };
  assert.equal(isStale(cached, [...before, session(4)]), true);
});

test('analysing a previously bare session makes the cache stale', () => {
  // The session count does not change here — only the analysed count does,
  // which is exactly the case a naive length check would miss.
  const bare = session(4, { ai_analysis: null, transcript: 'т' });
  const before = [session(1), session(2), session(3), bare];
  const cached = { signature: cacheSignature(before) };
  const after = [session(1), session(2), session(3), session(4)];
  assert.equal(isStale(cached, after), true);
});

test('a missing or malformed cache is treated as stale, never shown as current', () => {
  assert.equal(isStale(null, [session(1)]), true);
  assert.equal(isStale({}, [session(1)]), true);
  assert.equal(isStale({ signature: null }, [session(1)]), true);
});

// ── response shape ───────────────────────────────────────────────────────────

test('the schema requires all four sections and forbids extra keys', () => {
  assert.deepEqual(PATTERNS_SCHEMA.required,
    ['recurring_themes', 'emotional_patterns', 'triggers', 'shifts']);
  assert.equal(PATTERNS_SCHEMA.additionalProperties, false);
  for (const key of PATTERNS_SCHEMA.required) {
    const item = PATTERNS_SCHEMA.properties[key].items;
    assert.equal(item.additionalProperties, false, `${key} must forbid extra keys`);
    assert.ok(item.required.length >= 2, `${key} must require its fields`);
  }
});

test('every section the page renders exists in the schema, and vice versa', () => {
  // Guards the field-name drift that silently disabled features elsewhere in
  // this app: the renderer and the schema are generated from one list.
  const schemaKeys = PATTERNS_SCHEMA.required;
  const uiKeys = PATTERN_SECTIONS.map(s => s.key);
  assert.deepEqual(uiKeys.slice().sort(), schemaKeys.slice().sort());
  for (const s of PATTERN_SECTIONS) {
    assert.deepEqual(s.fields, PATTERNS_SCHEMA.properties[s.key].items.required,
      `${s.key}: the fields the page reads must be the ones the model must return`);
  }
});

test('an all-empty analysis is reported as no patterns, not as a result', () => {
  assert.equal(hasAnyPattern({ recurring_themes: [], emotional_patterns: [], triggers: [], shifts: [] }), false);
  assert.equal(hasAnyPattern({ recurring_themes: [{ theme: 'x' }], emotional_patterns: [], triggers: [], shifts: [] }), true);
  assert.equal(hasAnyPattern(null), false);
  assert.equal(hasAnyPattern('nonsense'), false);
});
