// Critical path: everything the user types must actually reach the right column.
//
// This layer is where a save silently becomes a no-op — a column renamed in a
// migration, a field dropped on the way to insert(), or an RLS rejection that
// returns zero rows without an error. Each of those has happened here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sessions, diary, emotions, homework, journals, customJournals, topics, aiChats,
  ARCHIVE_PAGE,
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

// ── emotion notes (migration 017) ────────────────────────────────────────────

test('an emotion note is stored alongside the log', async () => {
  const sb = fakeSupabase({ responses: { emotion_logs: { data: row({ emotion: 'Anxiety', note: 'поругалась с мамой' }) } } });
  const saved = await emotions.save(sb, {
    category: 'Anxiety', sub_emotions: ['worried'], intensity: 8, note: '  поругалась с мамой  ',
  });
  assert.equal(sb.lastCall().payload.note, 'поругалась с мамой', 'note is trimmed before insert');
  assert.equal(saved.note, 'поругалась с мамой');
});

test('an empty note is left out of the insert entirely', async () => {
  for (const note of ['', '   ', undefined, null]) {
    const sb = fakeSupabase({ responses: { emotion_logs: { data: row() } } });
    await emotions.save(sb, { category: 'Joy', sub_emotions: ['proud'], intensity: 5, note });
    assert.ok(!('note' in sb.lastCall().payload), `empty note (${JSON.stringify(note)}) must not be sent`);
  }
});

test('a log still saves when the note column has not been migrated yet', async () => {
  // Migration 017 may not have run. Losing the emotion because of an optional
  // extra would be the wrong trade: drop the column, keep the log.
  const sb = fakeSupabase({ responses: { emotion_logs: [
    { error: pgError('PGRST204', "Could not find the 'note' column of 'emotion_logs' in the schema cache") },
    { data: row({ emotion: 'Anxiety' }) },
  ] } });
  const saved = await emotions.save(sb, { category: 'Anxiety', sub_emotions: ['tense'], intensity: 7, note: 'контекст' });
  assert.equal(saved.category, 'Anxiety');
  const inserts = sb.callsFor('emotion_logs').filter(c => c.op === 'insert');
  assert.equal(inserts.length, 2);
  assert.ok(!('note' in inserts[1].payload), 'the retry must drop only the missing column');
  assert.deepEqual(inserts[1].payload.sub_emotions, ['tense'], 'and must keep the ones that do exist');
});

test('a missing sub_emotions column is still handled the same way', async () => {
  const sb = fakeSupabase({ responses: { emotion_logs: [
    { error: pgError('42703', 'column "sub_emotions" of relation "emotion_logs" does not exist') },
    { data: row({ emotion: 'Joy' }) },
  ] } });
  await emotions.save(sb, { category: 'Joy', sub_emotions: ['proud'], intensity: 6, note: 'сегодня получилось' });
  const inserts = sb.callsFor('emotion_logs').filter(c => c.op === 'insert');
  assert.ok(!('sub_emotions' in inserts[1].payload));
  assert.equal(inserts[1].payload.note, 'сегодня получилось', 'the note must survive a sub_emotions failure');
});

test('an error that is not a missing column is not retried away', async () => {
  const sb = fakeSupabase({ responses: { emotion_logs: { error: pgError('42501', 'RLS denied') } } });
  await assert.rejects(
    () => emotions.save(sb, { category: 'Joy', sub_emotions: ['proud'], intensity: 5, note: 'x' }),
    /RLS denied/);
});

// ── an update that matches no row ────────────────────────────────────────────
//
// PostgREST answers a zero-row UPDATE with PGRST116, "Cannot coerce the result
// to a single JSON object". That reached the user verbatim from the topic
// checkbox — the most-used control in the Dashboard list — and explains nothing
// about what went wrong or what to do.

test('toggling a topic that no longer exists explains itself', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: null } } });
  await assert.rejects(
    () => topics.update(sb, 'gone', { checked: true }),
    err => {
      assert.equal(err.code, 'NO_ROW');
      assert.match(err.message, /deleted|another account/i);
      assert.ok(!/coerce/i.test(err.message), 'the PostgREST wording must not reach the user');
      return true;
    },
  );
});

test('a homework checkbox on a missing row fails the same readable way', async () => {
  const sb = fakeSupabase({ responses: { homework: { data: null } } });
  await assert.rejects(
    () => homework.update(sb, 'gone', { completed: true }),
    err => { assert.equal(err.code, 'NO_ROW'); return true; },
  );
});

test('a normal update still returns the row', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: row({ text: 'Boundaries', checked: true }) } } });
  const updated = await topics.update(sb, 'row-1', { checked: true });
  assert.equal(updated.text, 'Boundaries');
});

// ── archiving discussed topics ───────────────────────────────────────────────
//
// Recording a session files away the topics it raised. The list is "what to
// bring next time", so it has to start empty again; the rows themselves are
// the record of what was discussed and are kept, never deleted.

test('the dashboard list asks only for topics that are not archived', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: [row({ text: 'Boundaries' })] } } });
  await topics.list(sb);
  const call = sb.lastCall();
  assert.ok(
    call.filters.some(([op, col, val]) => op === 'eq' && col === 'archived' && val === false),
    'archived rows belong to past sessions and must not come back into the block',
  );
});

test('a database without the archived column still lists topics', async () => {
  // Same contract as migration 018: an un-migrated database keeps working, it
  // simply has nothing archived yet.
  const sb = fakeSupabase({
    responses: {
      next_session_topics: [
        { error: pgError('42703', 'column "archived" does not exist') },
        { data: [row({ text: 'Boundaries' })] },
      ],
    },
  });
  const list = await topics.list(sb);
  assert.deepEqual(list.map(t => t.text), ['Boundaries']);
});

test('archiving files away the discussed topics and nothing else', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: [row({ text: 'Boundaries' })] } } });
  await topics.archiveDiscussed(sb);
  const call = sb.lastCall();
  assert.equal(call.op, 'update');
  assert.equal(call.payload.archived, true);
  const has = (col, val) => call.filters.some(([op, c, v]) => op === 'eq' && c === col && v === val);
  assert.ok(has('checked', true),   'only topics actually raised are filed away');
  assert.ok(has('archived', false), 'already-archived rows are left alone');
  assert.ok(has('user_id', 'user-1'));
});

test('archiving is a no-op on a database without the column', async () => {
  const sb = fakeSupabase({
    responses: { next_session_topics: { error: pgError('42703', 'column "archived" does not exist') } },
  });
  assert.deepEqual(await topics.archiveDiscussed(sb), []);
});

test('a real archiving failure is not swallowed', async () => {
  const sb = fakeSupabase({
    responses: { next_session_topics: { error: pgError('42501', 'RLS denied') } },
  });
  await assert.rejects(() => topics.archiveDiscussed(sb), /RLS denied/);
});

// ── reading and undoing the archive ──────────────────────────────────────────

test('archiving stamps when it happened', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: [row()] } } });
  await topics.archiveDiscussed(sb);
  const call = sb.lastCall();
  assert.equal(call.payload.archived, true);
  assert.ok(call.payload.archived_at, 'the archive view groups by this date');
  assert.ok(!Number.isNaN(Date.parse(call.payload.archived_at)));
});

test('archiving still works on a database without archived_at', async () => {
  // Migration 020 may not have run. Dropping the stamp is better than losing
  // the archive: the view falls back to created_at and says so.
  const sb = fakeSupabase({
    responses: {
      next_session_topics: [
        { error: pgError('PGRST204', "Could not find the 'archived_at' column in the schema cache") },
        { data: [row()] },
      ],
    },
  });
  const archived = await topics.archiveDiscussed(sb);
  assert.equal(archived.length, 1);
  const call = sb.lastCall();
  assert.equal(call.payload.archived, true);
  assert.ok(!('archived_at' in call.payload), 'the retry drops only the missing column');
});

test('the archive view asks only for archived rows', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: [row({ text: 'Boundaries' })] } } });
  const { items } = await topics.listArchived(sb);
  const call = sb.lastCall();
  assert.ok(call.filters.some(([op, c, v]) => op === 'eq' && c === 'archived' && v === true));
  assert.deepEqual(items.map(t => t.text), ['Boundaries']);
});

test('an un-migrated database has an empty archive rather than an error', async () => {
  const sb = fakeSupabase({
    responses: { next_session_topics: { error: pgError('42703', 'column "archived" does not exist') } },
  });
  assert.deepEqual(await topics.listArchived(sb), { items: [], hasMore: false });
});

test('restoring puts a topic back among the active ones', async () => {
  // Not merely un-archived: an archived topic is also checked, and leaving it
  // checked would drop it straight into the "done" fold instead of the list
  // the user restored it to raise again.
  const sb = fakeSupabase({ responses: { next_session_topics: { data: row({ text: 'Boundaries' }) } } });
  await topics.restore(sb, 'row-1');
  const call = sb.lastCall();
  assert.equal(call.payload.archived, false);
  assert.equal(call.payload.checked, false);
});

test('restoring a row that is gone explains itself', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: null } } });
  await assert.rejects(() => topics.restore(sb, 'gone'), err => err.code === 'NO_ROW');
});

// ── ticking a topic off ──────────────────────────────────────────────────────
//
// There is one place for a finished topic now: the archive. Ticking the box
// files it away in a single write rather than parking it in a second, separate
// list of checked-but-not-archived rows — which was invisible in both views the
// moment the "done" fold was removed.

test('ticking a topic off archives it in one write', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: row({ text: 'Boundaries' }) } } });
  await topics.archive(sb, 'row-1');
  const call = sb.lastCall();
  assert.equal(call.op, 'update');
  assert.equal(call.payload.checked, true);
  assert.equal(call.payload.archived, true);
  assert.ok(call.payload.archived_at, 'the archive groups by this date');
  assert.ok(!Number.isNaN(Date.parse(call.payload.archived_at)));
});

test('ticking off still works without the archived_at column', async () => {
  const sb = fakeSupabase({
    responses: {
      next_session_topics: [
        { error: pgError('PGRST204', "Could not find the 'archived_at' column in the schema cache") },
        { data: row({ text: 'Boundaries' }) },
      ],
    },
  });
  const filed = await topics.archive(sb, 'row-1');
  assert.equal(filed.text, 'Boundaries');
  const call = sb.lastCall();
  assert.equal(call.payload.archived, true);
  assert.ok(!('archived_at' in call.payload));
});

test('ticking off a topic that is gone explains itself', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: null } } });
  await assert.rejects(() => topics.archive(sb, 'gone'), err => err.code === 'NO_ROW');
});

test('an archived topic comes back shaped for the archive view', async () => {
  const sb = fakeSupabase({
    responses: { next_session_topics: { data: row({ text: 'Boundaries', source: 'ai' }) } },
  });
  const filed = await topics.archive(sb, 'row-1');
  assert.equal(filed.archived, true);
  assert.equal(filed.checked, true);
  assert.equal(filed.source, 'ai', 'the ✦ mark must survive the trip into the archive');
});

// ── the archive is paged ─────────────────────────────────────────────────────
//
// It grows by every topic ever ticked off, so the block asks for one screenful
// and says whether there is more. Fetching the whole table to show twenty rows
// gets slower every week and is invisible until it is bad.

const rows = n => Array.from({ length: n }, (_, i) => row({ id: `row-${i}`, text: `topic ${i}` }));

test('the archive asks for one page, newest first', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: rows(5) } } });
  await topics.listArchived(sb);
  const call = sb.lastCall();
  assert.equal(call.order[0], 'archived_at');
  assert.equal(call.order[1].ascending, false, 'the most recently filed come first');
  // One more than the page, so "is there more" costs no second query.
  assert.equal(call.limit, ARCHIVE_PAGE + 1);
});

test('a full page reports that there is more, and does not leak the probe row', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: rows(ARCHIVE_PAGE + 1) } } });
  const { items, hasMore } = await topics.listArchived(sb);
  assert.equal(hasMore, true);
  assert.equal(items.length, ARCHIVE_PAGE, 'the extra row was only ever a probe');
});

test('a short page reports that there is no more', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: rows(3) } } });
  const { items, hasMore } = await topics.listArchived(sb);
  assert.equal(hasMore, false);
  assert.equal(items.length, 3);
});

test('Show all drops the limit entirely', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: rows(50) } } });
  const { items, hasMore } = await topics.listArchived(sb, { limit: null });
  assert.equal(sb.lastCall().limit, undefined, 'no limit is sent at all');
  assert.equal(items.length, 50);
  assert.equal(hasMore, false, 'everything was asked for, so nothing is left');
});

test('a database without archived_at is still ordered, by when the topic was added', async () => {
  // Without migration 020 there is nothing to sort by but created_at. Ordering
  // by a column that does not exist would fail the whole query, so it retries.
  const sb = fakeSupabase({
    responses: {
      next_session_topics: [
        { error: pgError('42703', 'column "archived_at" does not exist') },
        { data: rows(2) },
      ],
    },
  });
  const { items } = await topics.listArchived(sb);
  assert.equal(items.length, 2);
  assert.equal(sb.lastCall().order[0], 'created_at');
});
