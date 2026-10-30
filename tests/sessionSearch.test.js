import { test } from 'node:test';
import assert from 'node:assert/strict';

import { searchSessions, SEARCH_SESSIONS_TOOL, formatSearchResult } from '../src/lib/sessionSearch.js';

const filler = (n) => 'бла '.repeat(n);
const sessions = [
  { id: 'a', created_at: '2026-10-28T10:00:00Z', title: 'Сессия', transcript: `${filler(200)}Потом я сказала маме, что не приеду на выходные.${filler(200)}` },
  { id: 'b', created_at: '2026-10-14T10:00:00Z', title: null, transcript: 'Про работу и дедлайны.', notes: 'Поговорить с МАМОЙ о деньгах' },
  { id: 'c', created_at: '2026-09-01T10:00:00Z', transcript: 'Ничего общего.' },
];

test('finds a conversation by any of several word forms, newest session first, with its date', () => {
  const hits = searchSessions(sessions, ['мама', 'маме', 'мамой']);
  assert.deepEqual(hits.map(h => h.date), ['2026-10-28', '2026-10-14']);
  assert.match(hits[0].excerpt, /сказала маме, что не приеду/);
  assert.match(hits[1].excerpt, /МАМОЙ о деньгах/);
});

test('an excerpt is a window around the match, not the whole two-hour transcript', () => {
  const [hit] = searchSessions(sessions, ['маме']);
  assert.ok(hit.excerpt.length < 700, `excerpt is ${hit.excerpt.length} chars`);
  assert.match(hit.excerpt, /^…/);
  assert.match(hit.excerpt, /…$/);
});

test('nearby matches in one session are merged into one excerpt', () => {
  const s = [{ created_at: '2026-10-01T00:00:00Z', transcript: 'мама сказала, и мама ушла, а мама вернулась' }];
  assert.equal(searchSessions(s, ['мама']).length, 1);
});

test('a date range narrows the search', () => {
  const hits = searchSessions(sessions, ['мам'], { from: '2026-10-20' });
  assert.deepEqual(hits.map(h => h.date), ['2026-10-28']);
});

test('nothing found, blank terms and deleted sessions give no results', () => {
  assert.deepEqual(searchSessions(sessions, ['собака']), []);
  assert.deepEqual(searchSessions(sessions, ['', '  ']), []);
  assert.deepEqual(searchSessions([{ ...sessions[0], deleted_at: '2026-10-29' }], ['маме']), []);
});

test('the result tells the model plainly when nothing was found', () => {
  assert.match(formatSearchResult([], ['собака']), /No matches/);
  assert.match(formatSearchResult(searchSessions(sessions, ['маме']), ['маме']), /2026-10-28/);
});

test('the tool asks the model for several word forms, because Russian inflects', () => {
  assert.equal(SEARCH_SESSIONS_TOOL.name, 'search_sessions');
  assert.match(SEARCH_SESSIONS_TOOL.description, /word forms/);
  assert.deepEqual(SEARCH_SESSIONS_TOOL.input_schema.required, ['terms']);
});
