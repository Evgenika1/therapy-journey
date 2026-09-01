// Critical path: everything the user types must actually reach the right column.
//
// This layer is where a save silently becomes a no-op — a column renamed in a
// migration, a field dropped on the way to insert(), or an RLS rejection that
// returns zero rows without an error. Each of those has happened here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sessions, diary, emotions, homework, journals, customJournals, topics, aiChats,
} from '../src/lib/api.js';
import { fakeSupabase, pgError } from './helpers/fakeSupabase.js';

const row = (extra = {}) => ({ id: 'row-1', user_id: 'user-1', created_at: '2026-09-01T10:00:00Z', ...extra });

// ── sessions: record → transcript → save ─────────────────────────────────────

test('saving a session writes the transcript, mood pair and duration', async () => {
  const sb = fakeSupabase({ responses: { sessions: { data: [row({ transcript: 'т' })] } } });
  await sessions.save(sb, {
    title: 'Session', transcript: 'Мне тревожно.', notes: 'заметка',
    duration: 5460, mood_before: 4, mood_after: 8,
  });
  const { payload } = sb.lastCall();
  assert.equal(payload.user_id, 'user-1');
  assert.equal(payload.transcript, 'Мне тревожно.');
  assert.equal(payload.notes, 'заметка');
  assert.equal(payload.duration, 5460);
  assert.equal(payload.mood_before, 4);
  assert.equal(payload.mood_after, 8);
});

test('a mood of 0 is stored, not dropped as falsy', async () => {
  const sb = fakeSupabase({ responses: { sessions: { data: [row()] } } });
  await sessions.save(sb, { transcript: 't', mood_before: 0, mood_after: 0, duration: 0 });
  const { payload } = sb.lastCall();
  assert.equal(payload.mood_before, 0);
  assert.equal(payload.mood_after, 0);
  assert.equal(payload.duration, 0);
});

test('an RLS-blocked insert that returns no rows is reported, not treated as saved', async () => {
  const sb = fakeSupabase({ responses: { sessions: { data: [] } } });
  await assert.rejects(
    () => sessions.save(sb, { transcript: 'т' }),
    /RLS blocked the insert|no row returned/,
  );
});

test('saving while signed out fails loudly instead of losing the transcript', async () => {
  const sb = fakeSupabase({ user: null });
  await assert.rejects(() => sessions.save(sb, { transcript: 'т' }), /Not signed in/);
});

test('a database error surfaces its message rather than "[object Object]"', async () => {
  const sb = fakeSupabase({
    responses: { sessions: { error: pgError('42501', 'new row violates row-level security policy') } },
  });
  await assert.rejects(() => sessions.save(sb, { transcript: 'т' }), err => {
    assert.match(err.message, /row-level security/);
    assert.equal(err.code, '42501');
    return true;
  });
});

test('a Recall session is deduped on the bot id instead of saved twice', async () => {
  const existing = row({ recall_bot_id: 'bot-9', transcript: 'уже сохранено' });
  const sb = fakeSupabase({ responses: { sessions: { data: existing } } });
  const got = await sessions.saveFromRecall(sb, { transcript: 'новое', recall_bot_id: 'bot-9' });
  assert.equal(got, existing);
  // Only the lookup ran — no insert.
  assert.ok(sb.callsFor('sessions').every(c => c.op !== 'insert'));
});

test('deleting a session is a soft delete', async () => {
  const sb = fakeSupabase({ responses: { sessions: { data: [row()] } } });
  await sessions.delete(sb, 'row-1');
  const call = sb.lastCall();
  assert.equal(call.op, 'update');
  assert.ok(call.payload.deleted_at, 'should stamp deleted_at, not DELETE the row');
});

test('the session list hides soft-deleted rows', async () => {
  const sb = fakeSupabase({ responses: { sessions: { data: [] } } });
  await sessions.list(sb);
  assert.deepEqual(sb.lastCall().filters, [['is', 'deleted_at', null]]);
});

test('stats average only sessions that have both moods', async () => {
  const sb = fakeSupabase({ responses: { sessions: { data: [
    { mood_before: 4, mood_after: 8, ai_analysis: '{}' },
    { mood_before: 2, mood_after: 6, ai_analysis: null },
    { mood_before: null, mood_after: null, ai_analysis: null },
  ] } } });
  const s = await sessions.stats(sb);
  assert.equal(s.total, 3);
  assert.equal(s.avgLift, '4.0');
  assert.equal(s.breakthroughs, 1);
});

test('stats survive a history with no mood data', async () => {
  const sb = fakeSupabase({ responses: { sessions: { data: [{ mood_before: null, mood_after: null }] } } });
  const s = await sessions.stats(sb);
  assert.equal(s.avgLift, null);
});

// ── emotions ─────────────────────────────────────────────────────────────────

test('a multi-select emotion log stores the category and the sub-emotion list', async () => {
  const sb = fakeSupabase({ responses: { emotion_logs: { data: row({ emotion: 'Anxiety', sub_emotions: ['worried', 'tense'] }) } } });
  const saved = await emotions.save(sb, { category: 'Anxiety', sub_emotions: ['worried', 'tense'], intensity: 7 });
  const { payload } = sb.lastCall();
  assert.equal(payload.emotion, 'Anxiety');
  assert.deepEqual(payload.sub_emotions, ['worried', 'tense']);
  assert.equal(payload.intensity, 7);
  // ...and comes back in the shape the UI renders.
  assert.equal(saved.category, 'Anxiety');
  assert.equal(saved.emotion_name, 'worried, tense');
});

test('a session before/after mood keeps the legacy single-emotion encoding', async () => {
  const sb = fakeSupabase({ responses: { emotion_logs: { data: row({ emotion: 'Session:Before' }) } } });
  await emotions.save(sb, { category: 'Session', emotion_name: 'Before', intensity: 4, session_tag: 'before' });
  const { payload } = sb.lastCall();
  assert.equal(payload.emotion, 'Session:Before');
  assert.equal(payload.session_tag, 'before');
});

test('an emotion log still saves when the sub_emotions column is missing', async () => {
  // Migration 013 may not have run; the first insert fails with 42703 and the
  // retry must drop the column rather than lose the log.
  const sb = fakeSupabase({ responses: { emotion_logs: [
    { error: pgError('42703', 'column "sub_emotions" does not exist') },
    { data: row({ emotion: 'Joy' }) },
  ] } });
  const saved = await emotions.save(sb, { category: 'Joy', sub_emotions: ['proud'], intensity: 8 });
  assert.equal(saved.category, 'Joy');
  const inserts = sb.callsFor('emotion_logs').filter(c => c.op === 'insert');
  assert.equal(inserts.length, 2);
  assert.ok(!('sub_emotions' in inserts[1].payload), 'retry must omit the missing column');
});

test('an emotion log error that is not a missing column is not retried away', async () => {
  const sb = fakeSupabase({ responses: { emotion_logs: { error: pgError('42501', 'RLS denied') } } });
  await assert.rejects(() => emotions.save(sb, { category: 'Joy', sub_emotions: ['proud'], intensity: 8 }), /RLS denied/);
});

test('legacy "Category:emotion" rows normalize for display', async () => {
  const sb = fakeSupabase({ responses: { emotion_logs: { data: [
    { id: 1, emotion: 'Sadness:lonely', sub_emotions: null, intensity: 6 },
    { id: 2, emotion: 'Calm', sub_emotions: ['safe', 'grounded'], intensity: 3 },
  ] } } });
  const [legacy, modern] = await emotions.list(sb);
  assert.equal(legacy.category, 'Sadness');
  assert.equal(legacy.emotion_name, 'lonely');
  assert.deepEqual(legacy.sub_emotions, []);
  assert.equal(modern.category, 'Calm');
  assert.equal(modern.emotion_name, 'safe, grounded');
});

// ── homework ─────────────────────────────────────────────────────────────────

test('homework writes title and description to the _enc columns', async () => {
  const sb = fakeSupabase({ responses: { homework: { data: row() } } });
  const saved = await homework.save(sb, { title: 'Дневник тревоги', description: 'каждый вечер', due_date: '2026-09-08' });
  const { payload } = sb.lastCall();
  assert.equal(payload.title_enc, 'Дневник тревоги');
  assert.equal(payload.description_enc, 'каждый вечер');
  assert.equal(payload.due_date, '2026-09-08');
  assert.equal(payload.completed, false);
  // The returned item must carry the plain fields the list renders.
  assert.equal(saved.title, 'Дневник тревоги');
  assert.equal(saved.description, 'каждый вечер');
});

test('homework reads back from either the plain or the _enc columns', async () => {
  const sb = fakeSupabase({ responses: { homework: { data: [
    { id: 1, title_enc: 'из enc', description_enc: 'описание' },
    { id: 2, title: 'обычная', description: null },
  ] } } });
  const [a, b] = await homework.list(sb);
  assert.equal(a.title, 'из enc');
  assert.equal(a.description, 'описание');
  assert.equal(b.title, 'обычная');
});

test('completing a homework item updates only `completed`', async () => {
  const sb = fakeSupabase({ responses: { homework: { data: row({ completed: true }) } } });
  await homework.update(sb, 'row-1', { completed: true });
  assert.deepEqual(sb.lastCall().payload, { completed: true });
});

test('editing a homework title writes title_enc, keeping the update scoped to the owner', async () => {
  const sb = fakeSupabase({ responses: { homework: { data: row() } } });
  await homework.update(sb, 'row-1', { title: 'новое имя' });
  const call = sb.lastCall();
  assert.deepEqual(call.payload, { title_enc: 'новое имя' });
  assert.deepEqual(call.filters, [['eq', 'id', 'row-1'], ['eq', 'user_id', 'user-1']]);
});

// ── journals & diary ─────────────────────────────────────────────────────────

test('a journal entry stores its type and content', async () => {
  const sb = fakeSupabase({ responses: { journal_entries: { data: row() } } });
  const saved = await journals.save(sb, { type: 'gratitude', content: 'Благодарен за поддержку.' });
  const { payload } = sb.lastCall();
  assert.equal(payload.type, 'gratitude');
  assert.equal(payload.content_encrypted, 'Благодарен за поддержку.');
  assert.equal(saved.content, 'Благодарен за поддержку.');
});

test('the journal list filters by type and exposes content', async () => {
  const sb = fakeSupabase({ responses: { journal_entries: { data: [{ id: 1, content_encrypted: 'текст' }] } } });
  const [entry] = await journals.list(sb, 'cbt');
  assert.deepEqual(sb.lastCall().filters, [['eq', 'type', 'cbt']]);
  assert.equal(entry.content, 'текст');
});

test('a custom journal type round-trips its label through the `name` column', async () => {
  const sb = fakeSupabase({ responses: { custom_journal_types: { data: row({ name: 'Сны' }) } } });
  const saved = await customJournals.save(sb, { label: 'Сны' });
  assert.equal(sb.lastCall().payload.name, 'Сны');
  assert.equal(saved.label, 'Сны');
});

test('a diary entry stores mood and content and returns the content back', async () => {
  const sb = fakeSupabase({ responses: { diary_entries: { data: row() } } });
  const saved = await diary.save(sb, { mood: 3, content: 'Сегодня было легче.' });
  const { payload } = sb.lastCall();
  assert.equal(payload.mood, 3);
  assert.equal(payload.content, 'Сегодня было легче.');
  assert.equal(saved.content, 'Сегодня было легче.');
});

test('a diary mood of 0 is preserved', async () => {
  const sb = fakeSupabase({ responses: { diary_entries: { data: row() } } });
  await diary.save(sb, { mood: 0, content: 'x' });
  assert.equal(sb.lastCall().payload.mood, 0);
});

test('editing a diary entry updates only the fields provided', async () => {
  const sb = fakeSupabase({ responses: { diary_entries: { data: row() } } });
  await diary.update(sb, 'row-1', { content: 'исправлено' });
  assert.deepEqual(sb.lastCall().payload, { content: 'исправлено' });
});

// ── next-session topics ──────────────────────────────────────────────────────

test('a topic is saved with its text and starts unchecked', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: row() } } });
  const saved = await topics.save(sb, 'Поговорить о границах');
  assert.equal(sb.lastCall().payload.text, 'Поговорить о границах');
  assert.equal(saved.text, 'Поговорить о границах');
  assert.equal(saved.checked, false);
});

test('checking a topic off keeps its text', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: row({ text: 'Границы' }) } } });
  const updated = await topics.update(sb, 'row-1', { checked: true });
  assert.deepEqual(sb.lastCall().payload, { checked: true });
  assert.equal(updated.text, 'Границы');
});

// ── ai chats ─────────────────────────────────────────────────────────────────

test('a session chat is stored against its session', async () => {
  const sb = fakeSupabase({ responses: { ai_chats: { data: row() } } });
  const msgs = [{ role: 'user', content: 'привет' }];
  await aiChats.create(sb, 'Session chat', msgs, 'session-7');
  const { payload } = sb.lastCall();
  assert.equal(payload.session_id, 'session-7');
  assert.deepEqual(payload.messages, msgs);
});

test('every write is scoped to the signed-in user', async () => {
  // A missing user_id filter on update/delete is a cross-account data bug, not
  // just a bug — assert it on every mutating call in the data layer.
  const cases = [
    sb => sessions.update(sb, 'id', { notes: 'n' }),
    sb => sessions.delete(sb, 'id'),
    sb => diary.update(sb, 'id', { content: 'c' }),
    sb => diary.delete(sb, 'id'),
    sb => emotions.update(sb, 'id', { intensity: 5 }),
    sb => emotions.delete(sb, 'id'),
    sb => homework.update(sb, 'id', { completed: true }),
    sb => homework.delete(sb, 'id'),
    sb => journals.delete(sb, 'id'),
    sb => customJournals.delete(sb, 'id'),
    sb => topics.update(sb, 'id', { checked: true }),
    sb => topics.delete(sb, 'id'),
    sb => aiChats.update(sb, 'id', []),
    sb => aiChats.delete(sb, 'id'),
  ];
  for (const run of cases) {
    const sb = fakeSupabase({ responses: new Proxy({}, { get: () => ({ data: row() }) }) });
    await run(sb);
    const filters = sb.lastCall().filters.map(f => f[1]);
    assert.ok(filters.includes('user_id'), `missing user_id scope on ${sb.lastCall().table}`);
  }
});
