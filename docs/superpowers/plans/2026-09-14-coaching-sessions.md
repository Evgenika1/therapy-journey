# Coaching Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user record coaching sessions next to therapy sessions, and give coaching sessions a goal-centred analysis whose goals carry over from one session to the next.

**Architecture:** A `kind` column (`'therapy' | 'coaching'`) on `sessions` and `next_session_topics`. Everything that differs by kind is a pure function in `src/lib/`: kind helpers, goal carry-over, the coaching prompt, the coaching analysis schema, chat intros. Pages only wire these in. Goals are not a table. They live inside the coaching session's `ai_analysis` JSON, and the previous session's goals are passed into the next analysis.

**Tech Stack:** Next.js 16 App Router (JS/JSX, inline styles plus `globals.css`), Supabase (Postgres plus RLS, migrations run by hand in the SQL editor), Anthropic Messages API with `output_config.format` JSON schema, `node --test` for tests (`npm test`).

**Spec:** `docs/superpowers/specs/2026-09-14-coaching-sessions-design.md`

## Global Constraints

- Session kinds are exactly `'therapy'` and `'coaching'`. A missing, empty, or unknown kind is `'therapy'`.
- Existing sessions and topics become therapy, both through the column default and in code that reads rows.
- The app must keep working before migration 023 is run. Every write that adds `kind` retries without it on a missing-column error (`42703` / `PGRST204`), following the existing pattern in `src/lib/api.js`.
- The therapy analysis prompt and `ANALYSIS_FIELDS` do not change.
- The coaching analysis keeps the field names `homework` and `for_next_session`, so `proposedTasks` and `aiTopics` work unchanged.
- Goal statuses are exactly `new | in_progress | changed | achieved | dropped`. The Current goals card shows only `new | in_progress | changed`, at most 5.
- Coaching analysis rules: same language as the transcript; only what is in the transcript; steps only if actually agreed; direct but not pushy; flag heavy topics gently, never diagnose.
- Interface copy is English. No clinical labels in coaching copy.
- Tests use `node:test` plus `node:assert/strict`. Data-layer tests use `tests/helpers/fakeSupabase.js`.
- Commit after each task. Do not push. The user pushes, or asks for it.

## Deviations from the spec (agreed in planning, recorded in Task 11)

1. **No Recall-bot kind.** `/api/recall/start` is not called anywhere in the interface, so there is no "start the bot" moment to choose a kind. Recall sessions save as therapy, and their kind can be changed on the session page.
2. **Topics follow the Dashboard switch instead of tabs.** The Therapy/Coaching switch on the Dashboard already says which session is next, so the topics block shows and adds topics of that kind. A second control for the same choice is redundant. The Past topics archive stays unfiltered.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/023_session_kind.sql` | create | `kind` columns and checks |
| `src/lib/sessionKind.js` | create | kinds, normalisation, last-used kind in `localStorage` |
| `src/lib/coachingGoals.js` | create | goal normalisation, previous goals, current goals |
| `src/lib/coachingPrompt.js` | create | the coaching analysis prompt text |
| `src/lib/chatPrompts.js` | create | chat system-prompt intros per kind, coaching suggestions |
| `src/lib/analysisFormat.js` | modify | `COACHING_FIELDS`, schema builder, `fieldsForKind`, `schemaForKind`, item text |
| `src/lib/sessionHomework.js` | modify | carry `due` through to the task description |
| `src/lib/api.js` | modify | `kind` in `sessions.save`, `topics.list/save/archiveDiscussed` |
| `src/lib/patternsInput.js` | modify | session `type` plus coaching fields in the patterns history |
| `src/lib/chatPresets.js` | modify | neutral wording |
| `src/app/api/analyze/route.js` | modify | pick prompt and schema by kind |
| `src/app/api/patterns/route.js` | modify | neutral role, cross-kind instruction |
| `src/app/api/chat/route.js` | modify | neutral default system prompt |
| `src/app/sessions/page.js` | modify | save kind, analyse with kind and previous goals, kind switch, render coaching sections, chat intro |
| `src/app/page.js` | modify | kind switch, Current goals card, neutral copy |
| `src/components/NextSessionTopics.jsx` | modify | `kind` prop |
| `src/components/SuggestionList.jsx` | modify | `suggestions` prop |
| `src/app/homework/page.js` | modify | kind label, neutral copy |
| `src/app/ai-chat/page.js`, `src/app/layout.js`, `src/app/auth/page.js`, `src/app/journals/page.js` | modify | neutral copy |
| `tests/sessionKind.test.js`, `tests/coachingGoals.test.js`, `tests/coachingPrompt.test.js`, `tests/chatPrompts.test.js` | create | tests |
| `tests/persistence.test.js`, `tests/analysis.test.js`, `tests/sessionHomework.test.js`, `tests/patterns.test.js` | modify | tests |

---

### Task 1: Session kind helpers and migration

**Files:**
- Create: `src/lib/sessionKind.js`
- Create: `supabase/migrations/023_session_kind.sql`
- Test: `tests/sessionKind.test.js`

**Interfaces:**
- Produces:
  - `SESSION_KINDS: ['therapy','coaching']`
  - `DEFAULT_KIND: 'therapy'`
  - `KIND_LABELS: { therapy: 'Therapy', coaching: 'Coaching' }`
  - `normalizeKind(value: any): 'therapy'|'coaching'`
  - `kindOf(row: {kind?}): 'therapy'|'coaching'`
  - `readLastKind(storage?): kind`
  - `rememberKind(kind, storage?): kind`

- [ ] **Step 1: Write the failing test**

Create `tests/sessionKind.test.js`:

```js
// Every row written before migration 023 has no kind, and every one of them was
// a therapy session. That default is the whole safety of this feature, so it is
// pinned here rather than repeated at call sites.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SESSION_KINDS, DEFAULT_KIND, KIND_LABELS, normalizeKind, kindOf, readLastKind, rememberKind,
} from '../src/lib/sessionKind.js';

const memoryStorage = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test('there are exactly two kinds, therapy first', () => {
  assert.deepEqual(SESSION_KINDS, ['therapy', 'coaching']);
  assert.equal(DEFAULT_KIND, 'therapy');
  assert.deepEqual(KIND_LABELS, { therapy: 'Therapy', coaching: 'Coaching' });
});

test('anything that is not a known kind is therapy', () => {
  assert.equal(normalizeKind('coaching'), 'coaching');
  assert.equal(normalizeKind('therapy'), 'therapy');
  for (const v of [undefined, null, '', 'Coaching', 'mentoring', 42, {}]) {
    assert.equal(normalizeKind(v), 'therapy', `${JSON.stringify(v)} should be therapy`);
  }
});

test('a row without a kind column is a therapy session', () => {
  assert.equal(kindOf({ id: 's1' }), 'therapy');
  assert.equal(kindOf({ kind: 'coaching' }), 'coaching');
  assert.equal(kindOf(null), 'therapy');
});

test('the last chosen kind is remembered and read back', () => {
  const storage = memoryStorage();
  assert.equal(readLastKind(storage), 'therapy');
  assert.equal(rememberKind('coaching', storage), 'coaching');
  assert.equal(readLastKind(storage), 'coaching');
});

test('storage that throws or holds junk never breaks recording', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readLastKind(broken), 'therapy');
  assert.equal(rememberKind('coaching', broken), 'coaching');
  const junk = memoryStorage(); junk.setItem('miru.sessionKind', 'nonsense');
  assert.equal(readLastKind(junk), 'therapy');
  assert.equal(readLastKind(undefined), 'therapy');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sessionKind.test.js`
Expected: FAIL. Error: `Cannot find module '.../src/lib/sessionKind.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/sessionKind.js`:

```js
// Therapy or coaching: which kind of session a row is.
//
// Pure functions plus one storage seam. The default matters more than anything
// else here: every session written before migration 023 has no kind, and all of
// them were therapy, so "missing" and "unknown" both mean therapy — in code as
// well as in the column default, because the app must keep working on a
// database that has not run the migration yet.

export const SESSION_KINDS = ['therapy', 'coaching'];
export const DEFAULT_KIND = 'therapy';
export const KIND_LABELS = { therapy: 'Therapy', coaching: 'Coaching' };

export function normalizeKind(value) {
  return SESSION_KINDS.includes(value) ? value : DEFAULT_KIND;
}

export const kindOf = (row) => normalizeKind(row?.kind);

// The Dashboard switch remembers the last choice so someone who only sees a
// coach picks it once. Storage can be missing (server render), blocked (private
// mode) or hold anything, and none of that may stop a recording.
const STORAGE_KEY = 'miru.sessionKind';
const defaultStorage = () => (typeof localStorage === 'undefined' ? undefined : localStorage);

export function readLastKind(storage = defaultStorage()) {
  try { return normalizeKind(storage?.getItem(STORAGE_KEY)); } catch { return DEFAULT_KIND; }
}

export function rememberKind(kind, storage = defaultStorage()) {
  const k = normalizeKind(kind);
  try { storage?.setItem(STORAGE_KEY, k); } catch { /* a lost preference is not an error */ }
  return k;
}
```

Create `supabase/migrations/023_session_kind.sql`:

```sql
-- Migration 023: coaching sessions alongside therapy sessions.
--
-- A session is either 'therapy' or 'coaching'. Every row that exists today was
-- a therapy session, so the default does the backfill. Topics carry the kind
-- too, so what you want to raise with a coach never shows up when preparing
-- for therapy, and the other way round.
--
-- Optional at the app level: code reading these rows treats a missing kind as
-- therapy, and writes retry without the column, so an un-migrated database
-- keeps working exactly as before. Run in the Supabase SQL editor.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'therapy';
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_kind_check;
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_kind_check CHECK (kind IN ('therapy', 'coaching'));

ALTER TABLE public.next_session_topics
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'therapy';
ALTER TABLE public.next_session_topics DROP CONSTRAINT IF EXISTS next_session_topics_kind_check;
ALTER TABLE public.next_session_topics
  ADD CONSTRAINT next_session_topics_kind_check CHECK (kind IN ('therapy', 'coaching'));

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sessionKind.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sessionKind.js tests/sessionKind.test.js supabase/migrations/023_session_kind.sql
git commit -m "feat(kind): therapy or coaching, defaulting to therapy everywhere"
```

---

### Task 2: Kind in the data layer

**Files:**
- Modify: `src/lib/api.js`:
  - `sessions.save`, around lines 68–91
  - `topics.list`, around lines 447–463
  - `topics.save`, around lines 480–500
  - `topics.archiveDiscussed`, around lines 522–552
- Test: `tests/persistence.test.js`

**Interfaces:**
- Consumes: `normalizeKind` from Task 1.
- Produces:
  - `sessions.save(supabase, { ...existing, kind? })` writes `kind`.
  - `topics.list(supabase, { kind? } = {})` returns rows with `kind`, filtered when `kind` is given.
  - `topics.save(supabase, text, { source?, session_id?, kind? })` writes `kind` and returns it.
  - `topics.archiveDiscussed(supabase, { kind? } = {})` archives only that kind when given.

- [ ] **Step 1: Write the failing tests**

Append to `tests/persistence.test.js`:

```js
// ── kind: therapy or coaching ────────────────────────────────────────────────

test('a session is saved with its kind', async () => {
  const sb = fakeSupabase({ responses: { sessions: { data: [row({ kind: 'coaching' })] } } });
  await sessions.save(sb, { transcript: 't', kind: 'coaching' });
  assert.equal(sb.lastCall().payload.kind, 'coaching');
});

test('a session with no or an unknown kind is saved as therapy', async () => {
  const sb = fakeSupabase({ responses: { sessions: { data: [row()] } } });
  await sessions.save(sb, { transcript: 't' });
  assert.equal(sb.lastCall().payload.kind, 'therapy');
  await sessions.save(sb, { transcript: 't', kind: 'mentoring' });
  assert.equal(sb.lastCall().payload.kind, 'therapy');
});

test('before migration 023 a session still saves, without the kind column', async () => {
  const sb = fakeSupabase({ responses: { sessions: [
    { error: pgError('PGRST204', "Could not find the 'kind' column of 'sessions' in the schema cache") },
    { data: [row({ transcript: 't' })] },
  ] } });
  const saved = await sessions.save(sb, { transcript: 't', kind: 'coaching' });
  assert.equal(saved.id, 'row-1');
  const inserts = sb.callsFor('sessions').filter(c => c.op === 'insert');
  assert.equal(inserts.length, 2);
  assert.ok(!('kind' in inserts[1].payload), 'the retry drops only the kind column');
  assert.equal(inserts[1].payload.transcript, 't');
});

test('topics are listed for one kind, legacy rows counting as therapy', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: [
    row({ id: 'a', text: 'Old topic' }),
    row({ id: 'b', text: 'Therapy topic', kind: 'therapy' }),
    row({ id: 'c', text: 'Coaching topic', kind: 'coaching' }),
  ] } } });
  assert.deepEqual((await topics.list(sb, { kind: 'therapy' })).map(t => t.id), ['a', 'b']);
  assert.deepEqual((await topics.list(sb, { kind: 'coaching' })).map(t => t.id), ['c']);
  const all = await topics.list(sb);
  assert.deepEqual(all.map(t => t.kind), ['therapy', 'therapy', 'coaching']);
});

test('a topic is saved with its kind', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: row({ text: 'Goal' }) } } });
  const saved = await topics.save(sb, 'Goal', { kind: 'coaching' });
  assert.equal(sb.lastCall().payload.kind, 'coaching');
  assert.equal(saved.kind, 'coaching');
});

test('a topic still saves without the kind column', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: [
    { error: pgError('42703', 'column "kind" of relation "next_session_topics" does not exist') },
    { data: row({ text: 'Goal' }) },
  ] } });
  await topics.save(sb, 'Goal', { kind: 'coaching', source: 'ai' });
  const inserts = sb.callsFor('next_session_topics').filter(c => c.op === 'insert');
  assert.equal(inserts.length, 2);
  assert.ok(!('kind' in inserts[1].payload));
  assert.equal(inserts[1].payload.source, 'ai');
});

test('recording a coaching session archives only coaching topics', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: { data: [] } } });
  await topics.archiveDiscussed(sb, { kind: 'coaching' });
  const call = sb.lastCall();
  assert.ok(call.filters.some(([op, c, v]) => op === 'eq' && c === 'kind' && v === 'coaching'));
});

test('archiving by kind falls back to all topics before migration 023', async () => {
  const sb = fakeSupabase({ responses: { next_session_topics: [
    { error: pgError('42703', 'column next_session_topics.kind does not exist') },
    { data: [row({ text: 'Boundaries' })] },
  ] } });
  const filed = await topics.archiveDiscussed(sb, { kind: 'therapy' });
  assert.equal(filed.length, 1);
  const updates = sb.callsFor('next_session_topics').filter(c => c.op === 'update');
  assert.equal(updates.length, 2);
  assert.ok(!updates[1].filters.some(([, c]) => c === 'kind'), 'the retry drops the kind filter');
  assert.ok('archived_at' in updates[1].payload, 'and keeps the archive date');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/persistence.test.js`
Expected: the 8 new tests FAIL, for example `payload.kind` is `undefined`. Existing tests still pass.

- [ ] **Step 3: Implement**

In `src/lib/api.js`, add at the top next to the other imports (or as the first import if there are none):

```js
import { normalizeKind } from './sessionKind.js';
```

Replace the whole `async save(supabase, session) { ... }` inside `export const sessions = {` with:

```js
  async save(supabase, session) {
    const { data: { user } } = await supabase.auth.getUser();
    console.log('[Save] auth user:', user?.id);
    if (!user) throw new Error('Not signed in — cannot save session.');
    const insert = {
      user_id:     user.id,
      title:       session.title       || null,
      duration:    session.duration    ?? null,
      mood_before: session.mood_before ?? null,
      mood_after:  session.mood_after  ?? null,
      ai_analysis: session.ai_analysis || null,
      transcript:  session.transcript  || null,
      notes:       session.notes       || null,
      kind:        normalizeKind(session.kind),
    };
    let { data, error } = await supabase.from('sessions').insert(insert).select();
    // Migration 023 adds kind. Without it every row is therapy anyway, so a
    // recording must not be lost for want of a column that says so.
    if (error && isMissingColumn(error) && missingColumnName(error) === 'kind') {
      delete insert.kind;
      ({ data, error } = await supabase.from('sessions').insert(insert).select());
    }
    console.log('[Save] result data:', data, 'error:', error);
    if (error) throw toError(error);
    if (!data || data.length === 0) throw new Error('Session not saved — no row returned (RLS blocked the insert?).');
    return data[0];
  },
```

In `topics.list`, change the signature and the mapping:

```js
  async list(supabase, { kind } = {}) {
```

and replace its `return data.map(t => ({ ... }));` with:

```js
    const rows = data.map(t => ({
      ...t,
      text:    t.text    ?? t.text_enc ?? '',
      checked: t.checked ?? false,
      // Rows written before migration 018 have no source; they were all typed.
      source:  t.source  ?? 'manual',
      // Rows written before migration 023 have no kind; they were all therapy.
      kind:    normalizeKind(t.kind),
    }));
    // Filtered here rather than in the query: before migration 023 there is no
    // column to filter on, and every row is therapy.
    return kind ? rows.filter(t => t.kind === normalizeKind(kind)) : rows;
```

In `topics.save`:
- After `if (meta.session_id) insert.session_id = meta.session_id;`, add:

```js
    if (meta.kind)       insert.kind       = normalizeKind(meta.kind);
```

- Change the retry loop bound from `i < 2` to `i < 3`, because up to three optional columns may be missing.
- Change the return to:

```js
    return { ...data, text, checked: false, source: meta.source || 'manual', kind: normalizeKind(meta.kind) };
```

Replace the whole `async archiveDiscussed(supabase) { ... }` with:

```js
  async archiveDiscussed(supabase, { kind } = {}) {
    const { data: { user } } = await supabase.auth.getUser();
    // The stamp is what the archive view groups by. Migration 020 may not have
    // run, so a missing archived_at drops to a plain archive rather than
    // failing — losing the date is recoverable, losing the archive is not.
    const updates = { archived: true, archived_at: new Date().toISOString() };
    // Recording a coaching session files away coaching topics only. Before
    // migration 023 every topic is therapy, so dropping the filter is exact.
    let byKind = kind ? normalizeKind(kind) : null;
    const run = () => {
      let q = supabase
        .from('next_session_topics')
        .update(updates)
        .eq('user_id', user.id)
        .eq('checked', true)
        .eq('archived', false);
      if (byKind) q = q.eq('kind', byKind);
      return q.select();
    };

    let { data, error } = await run();
    for (let i = 0; i < 2 && error && isMissingColumn(error); i++) {
      const column = missingColumnName(error);
      if (column === 'kind' && byKind) byKind = null;
      else if (column !== 'archived' && 'archived_at' in updates) delete updates.archived_at;
      else break;
      ({ data, error } = await run());
    }
    // Without migration 019 there is nothing to archive and nothing to report;
    // any other error is real and must not be swallowed behind a save.
    if (error) {
      if (isMissingColumn(error)) return [];
      throw toError(error);
    }
    return data ?? [];
  },
```

Note: `missingColumnName` extracts a quoted name. For `column next_session_topics.kind does not exist` there are no quotes, so it returns `null`. That is why the kind test uses the unquoted form, and why `column !== 'archived'` (not `=== 'archived_at'`) guards the date fallback. Change the `missingColumnName` regex so it also matches `table.column` without quotes:

```js
function missingColumnName(e) {
  const msg = String(e?.message || '');
  const quoted = msg.match(/["'`]([a-z_][a-z0-9_]*)["'`]/i);
  if (quoted) return quoted[1];
  const dotted = msg.match(/column\s+[a-z_][a-z0-9_]*\.([a-z_][a-z0-9_]*)/i);
  return dotted ? dotted[1] : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests including the 8 new ones and the existing archive tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.js tests/persistence.test.js
git commit -m "feat(kind): sessions and topics carry their kind, with pre-migration fallbacks"
```

---

### Task 3: Goal carry-over

**Files:**
- Create: `src/lib/coachingGoals.js`
- Test: `tests/coachingGoals.test.js`

**Interfaces:**
- Consumes: `kindOf` (Task 1), `parseAnalysis` from `src/lib/analysisParse.js`.
- Produces:
  - `GOAL_STATUSES: ['new','in_progress','changed','achieved','dropped']`
  - `OPEN_GOAL_STATUSES: ['new','in_progress','changed']`
  - `GOAL_STATUS_LABELS: { new:'New', in_progress:'In progress', changed:'Changed', achieved:'Achieved', dropped:'Set aside' }`
  - `MAX_CURRENT_GOALS: 5`
  - `normalizeGoals(raw): Array<{goal, status, progress}>`
  - `previousGoals(sessions, current): Array<{goal,status,progress}>`
  - `currentGoals(sessions): null | { session, goals }`

- [ ] **Step 1: Write the failing test**

Create `tests/coachingGoals.test.js`:

```js
// Goals are what make a coaching analysis more than a one-off summary: each
// session is read against the goals the previous one left. Which session counts
// as "previous" is the part that can go quietly wrong, so it is pinned here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GOAL_STATUSES, OPEN_GOAL_STATUSES, GOAL_STATUS_LABELS, MAX_CURRENT_GOALS,
  normalizeGoals, previousGoals, currentGoals,
} from '../src/lib/coachingGoals.js';

const goal = (g, status = 'in_progress', progress = '') => ({ goal: g, status, progress });
const session = (id, date, kind, goals, extra = {}) => ({
  id, created_at: `${date}T10:00:00Z`, kind,
  ai_analysis: goals === undefined ? null : JSON.stringify({ goals }),
  ...extra,
});

test('statuses and labels are fixed', () => {
  assert.deepEqual(GOAL_STATUSES, ['new', 'in_progress', 'changed', 'achieved', 'dropped']);
  assert.deepEqual(OPEN_GOAL_STATUSES, ['new', 'in_progress', 'changed']);
  assert.equal(GOAL_STATUS_LABELS.dropped, 'Set aside');
  assert.equal(MAX_CURRENT_GOALS, 5);
});

test('goals are cleaned: blanks dropped, unknown status becomes in progress', () => {
  assert.deepEqual(normalizeGoals([
    goal('  Launch the course  ', 'new', ' outline drafted '),
    { goal: '   ' }, null, { status: 'new' },
    { goal: 'Run twice a week', status: 'done?' },
  ]), [
    { goal: 'Launch the course', status: 'new', progress: 'outline drafted' },
    { goal: 'Run twice a week', status: 'in_progress', progress: '' },
  ]);
  assert.deepEqual(normalizeGoals('nope'), []);
});

test('no earlier coaching session means no previous goals', () => {
  const current = session('now', '2026-09-14', 'coaching');
  assert.deepEqual(previousGoals([current], current), []);
});

test('the latest earlier analysed coaching session supplies the goals', () => {
  const older  = session('a', '2026-08-01', 'coaching', [goal('Old goal')]);
  const recent = session('b', '2026-09-01', 'coaching', [goal('Recent goal')]);
  const current = session('c', '2026-09-14', 'coaching');
  assert.deepEqual(previousGoals([current, older, recent], current).map(g => g.goal), ['Recent goal']);
});

test('an unanalysed coaching session is skipped for the one before it', () => {
  const analysed   = session('a', '2026-08-01', 'coaching', [goal('Kept goal')]);
  const unanalysed = session('b', '2026-09-01', 'coaching');
  const current    = session('c', '2026-09-14', 'coaching');
  assert.deepEqual(previousGoals([analysed, unanalysed, current], current).map(g => g.goal), ['Kept goal']);
});

test('a therapy session in between does not count', () => {
  const coaching = session('a', '2026-08-01', 'coaching', [goal('Coaching goal')]);
  const therapy  = session('b', '2026-09-01', 'therapy', [goal('Should never appear')]);
  const current  = session('c', '2026-09-14', 'coaching');
  assert.deepEqual(previousGoals([coaching, therapy, current], current).map(g => g.goal), ['Coaching goal']);
});

test('a legacy session without a kind is therapy, so it does not count', () => {
  const legacy  = { id: 'a', created_at: '2026-09-01T10:00:00Z', ai_analysis: JSON.stringify({ goals: [goal('x')] }) };
  const current = session('c', '2026-09-14', 'coaching');
  assert.deepEqual(previousGoals([legacy, current], current), []);
});

test('deleted sessions and later sessions do not count', () => {
  const deleted = session('a', '2026-09-01', 'coaching', [goal('Deleted')], { deleted_at: '2026-09-02T00:00:00Z' });
  const later   = session('b', '2026-09-20', 'coaching', [goal('Later')]);
  const current = session('c', '2026-09-14', 'coaching');
  assert.deepEqual(previousGoals([deleted, later, current], current), []);
});

test('broken analysis JSON is skipped, not thrown', () => {
  const good    = session('a', '2026-08-01', 'coaching', [goal('Good')]);
  const broken  = { ...session('b', '2026-09-01', 'coaching'), ai_analysis: '{"goals": [' };
  const current = session('c', '2026-09-14', 'coaching');
  assert.deepEqual(previousGoals([good, broken, current], current).map(g => g.goal), ['Good']);
});

test('closed goals are still passed to the next analysis', () => {
  const prev = session('a', '2026-09-01', 'coaching', [goal('Done', 'achieved'), goal('Parked', 'dropped')]);
  const current = session('c', '2026-09-14', 'coaching');
  assert.deepEqual(previousGoals([prev, current], current).map(g => g.status), ['achieved', 'dropped']);
});

test('current goals: none without an analysed coaching session', () => {
  assert.equal(currentGoals([]), null);
  assert.equal(currentGoals([session('a', '2026-09-01', 'therapy', [goal('x')])]), null);
  assert.equal(currentGoals([session('a', '2026-09-01', 'coaching')]), null);
});

test('current goals hide achieved and set-aside goals and stop at five', () => {
  const goals = [
    goal('One', 'new'), goal('Two', 'achieved'), goal('Three', 'in_progress'), goal('Four', 'dropped'),
    goal('Five', 'changed'), goal('Six'), goal('Seven'), goal('Eight'),
  ];
  const latest = session('b', '2026-09-10', 'coaching', goals);
  const result = currentGoals([session('a', '2026-09-01', 'coaching', [goal('Old')]), latest]);
  assert.equal(result.session.id, 'b');
  assert.deepEqual(result.goals.map(g => g.goal), ['One', 'Three', 'Five', 'Six', 'Seven']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/coachingGoals.test.js`
Expected: FAIL. Error: `Cannot find module '.../src/lib/coachingGoals.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/coachingGoals.js`:

```js
// Goals across coaching sessions.
//
// There is no goals table. A coaching analysis returns the goals as they stand
// after that session, and the next analysis is given those to compare against.
// So "the goals" are always whatever the latest analysed coaching session said
// — which keeps them tied to what was actually said in the room.
//
// Pure functions: no React, no network, no clock.

import { parseAnalysis } from './analysisParse.js';
import { kindOf } from './sessionKind.js';

export const GOAL_STATUSES = ['new', 'in_progress', 'changed', 'achieved', 'dropped'];
export const OPEN_GOAL_STATUSES = ['new', 'in_progress', 'changed'];
export const GOAL_STATUS_LABELS = {
  new: 'New', in_progress: 'In progress', changed: 'Changed', achieved: 'Achieved', dropped: 'Set aside',
};
export const MAX_CURRENT_GOALS = 5;

const text = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export function normalizeGoals(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(g => g && typeof g.goal === 'string' && g.goal.trim())
    .map(g => ({
      goal:     text(g.goal, 200),
      status:   GOAL_STATUSES.includes(g.status) ? g.status : 'in_progress',
      progress: text(g.progress, 300),
    }));
}

const analysisOf = (s) => {
  const raw = s?.ai_analysis;
  if (!raw) return null;
  return typeof raw === 'object' ? raw : parseAnalysis(raw);
};

// Newest first; the first analysed coaching session with a goals list wins.
function latestCoachingGoals(sessions, before) {
  const candidates = (Array.isArray(sessions) ? sessions : [])
    .filter(s => s && !s.deleted_at && kindOf(s) === 'coaching')
    .filter(s => before == null || String(s.created_at || '') < before)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  for (const s of candidates) {
    const a = analysisOf(s);
    if (a && Array.isArray(a.goals)) return { session: s, goals: normalizeGoals(a.goals) };
  }
  return null;
}

// Goals to hand to the analysis of `current`. Closed goals are included: the
// model has to know a goal was achieved to avoid proposing it again as new.
export function previousGoals(sessions, current) {
  const others = (Array.isArray(sessions) ? sessions : []).filter(s => s?.id !== current?.id);
  return latestCoachingGoals(others, current?.created_at ?? null)?.goals ?? [];
}

// The Dashboard card: open goals from the latest analysed coaching session, or
// null when there is none, so the card is not shown at all.
export function currentGoals(sessions) {
  const found = latestCoachingGoals(sessions, null);
  if (!found) return null;
  return {
    session: found.session,
    goals: found.goals.filter(g => OPEN_GOAL_STATUSES.includes(g.status)).slice(0, MAX_CURRENT_GOALS),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/coachingGoals.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/coachingGoals.js tests/coachingGoals.test.js
git commit -m "feat(coaching): carry goals from one coaching session to the next"
```

---

### Task 4: Coaching analysis shape

**Files:**
- Modify: `src/lib/analysisFormat.js`
- Modify: `src/lib/sessionHomework.js`, functions `proposedTasks` and `describeTask`
- Test: `tests/analysis.test.js`, `tests/sessionHomework.test.js`

**Interfaces:**
- Consumes:
  - `normalizeKind` (Task 1)
  - `GOAL_STATUSES`, `GOAL_STATUS_LABELS` (Task 3)
- Produces:
  - `COACHING_FIELDS`
  - `COACHING_SCHEMA`
  - `fieldsForKind(kind)`
  - `schemaForKind(kind)`
  - `itemToText(item)`: handles goal, obstacle and task-with-due objects
  - `analysisToText(ai, kind?)`
  - `proposedTasks(analysis)`: items get `due` when present
  - `describeTask(task, sessionTitle)`: writes the due line

- [ ] **Step 1: Write the failing tests**

Append to `tests/analysis.test.js`. Also extend its import line with `COACHING_FIELDS, COACHING_SCHEMA, fieldsForKind, schemaForKind, itemToText`:

```js
// ── coaching ─────────────────────────────────────────────────────────────────

test('a coaching analysis has goals, steps, obstacles and insights', () => {
  assert.deepEqual(COACHING_FIELDS.map(f => f.key),
    ['topics_covered', 'overview', 'goals', 'homework', 'obstacles', 'insights', 'for_next_session']);
});

test('the coaching schema requires every field and constrains goal status', () => {
  assert.deepEqual(COACHING_SCHEMA.required, COACHING_FIELDS.map(f => f.key));
  assert.equal(COACHING_SCHEMA.additionalProperties, false);
  const goalItem = COACHING_SCHEMA.properties.goals.items;
  assert.deepEqual(goalItem.required, ['goal', 'status', 'progress']);
  assert.deepEqual(goalItem.properties.status.enum, ['new', 'in_progress', 'changed', 'achieved', 'dropped']);
  const stepItem = COACHING_SCHEMA.properties.homework.items;
  assert.deepEqual(stepItem.properties.due.type, ['string', 'null']);
  assert.equal(goalItem.additionalProperties, false);
});

test('the kind picks the fields and the schema, therapy by default', () => {
  assert.equal(fieldsForKind('coaching'), COACHING_FIELDS);
  assert.equal(fieldsForKind('therapy'), ANALYSIS_FIELDS);
  assert.equal(fieldsForKind(undefined), ANALYSIS_FIELDS);
  assert.equal(schemaForKind('coaching'), COACHING_SCHEMA);
  assert.equal(schemaForKind(null), ANALYSIS_SCHEMA);
});

test('coaching items read as text', () => {
  assert.equal(itemToText({ goal: 'Launch the course', status: 'in_progress', progress: 'outline done' }),
    'Launch the course (In progress) — outline done');
  assert.equal(itemToText({ obstacle: 'Fear of judgement', context: 'came up twice' }),
    'Fear of judgement — came up twice');
  assert.equal(itemToText({ task: 'Email two clients', due: 'by Friday', context: 'agreed at the end' }),
    'Email two clients (by Friday) — agreed at the end');
  assert.equal(itemToText({ task: 'Email two clients', due: null, context: '' }), 'Email two clients');
});

test('a coaching summary is copied with coaching labels', () => {
  const text = analysisToText({ goals: [{ goal: 'Run', status: 'new', progress: '' }], insights: ['I stall when unsure'] }, 'coaching');
  assert.match(text, /GOALS\n• Run \(New\)/);
  assert.match(text, /INSIGHTS\n• I stall when unsure/);
});
```

Append to `tests/sessionHomework.test.js` (import `describeTask` if it is not imported yet):

```js
test('an agreed step keeps its due date, and a practice without one is unchanged', () => {
  const out = proposedTasks({ homework: [
    { task: 'Email two clients', due: 'by Friday', context: 'agreed at the end' },
    { task: 'Notice the urge', due: null, context: 'avoiding conflict' },
  ]});
  assert.deepEqual(out, [
    { task: 'Email two clients', context: 'agreed at the end', due: 'by Friday' },
    { task: 'Notice the urge', context: 'avoiding conflict' },
  ]);
});

test('the due date is written into the task description', () => {
  assert.equal(describeTask({ task: 't', context: 'agreed', due: 'by Friday' }, 'Sep 14'),
    'agreed\nDue: by Friday\n\nFrom "Sep 14"');
  assert.equal(describeTask({ task: 't', context: '', due: 'by Friday' }, null),
    'Due: by Friday\n\nFrom a session');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/analysis.test.js tests/sessionHomework.test.js`
Expected: FAIL. Error: `does not provide an export named 'COACHING_FIELDS'`.

- [ ] **Step 3: Implement**

In `src/lib/analysisFormat.js`:

Add imports at the top:

```js
import { normalizeKind } from './sessionKind.js';
import { GOAL_STATUSES, GOAL_STATUS_LABELS } from './coachingGoals.js';
```

After `LEGACY_ANALYSIS_FIELDS`, add:

```js
// A coaching session is read for where the person is heading, not for what they
// felt. `homework` and `for_next_session` keep their therapy names on purpose:
// the code that turns them into tasks and topics then works for both kinds.
export const COACHING_FIELDS = [
  { key: 'topics_covered',   label: 'TOPICS COVERED',   color: '#0EA5E9', type: 'array' },
  { key: 'overview',         label: 'OVERVIEW',         color: '#3B82F6', type: 'array' },
  { key: 'goals',            label: 'GOALS',            color: '#10B981', type: 'objects', itemFields: ['goal', 'status', 'progress'] },
  { key: 'homework',         label: 'NEXT STEPS',       color: '#F59E0B', type: 'objects', itemFields: ['task', 'due', 'context'] },
  { key: 'obstacles',        label: 'OBSTACLES',        color: '#EF4444', type: 'objects', itemFields: ['obstacle', 'context'] },
  { key: 'insights',         label: 'INSIGHTS',         color: '#8B5CF6', type: 'array' },
  { key: 'for_next_session', label: 'FOR NEXT SESSION', color: '#6366F1', type: 'array' },
];

// Item properties that are not a plain string.
const ITEM_TYPES = {
  status: { type: 'string', enum: GOAL_STATUSES },
  due:    { type: ['string', 'null'] },
};
```

Replace `export const ANALYSIS_SCHEMA = { ... };`, including its comment block, with a builder plus both schemas:

```js
// Structured-outputs JSON schema, built from a field list. Structured outputs
// requires every object to declare `required` and `additionalProperties: false`.
function buildSchema(fields) {
  return {
    type: 'object',
    properties: Object.fromEntries(fields.map(f => [
      f.key,
      f.type === 'objects'
        // An array of small objects rather than strings: a practice that does not
        // say which part of the session it came from reads as generic advice, and
        // generic advice is what this feature exists to avoid.
        ? {
            type: 'array',
            items: {
              type: 'object',
              properties: Object.fromEntries(f.itemFields.map(k => [k, ITEM_TYPES[k] ?? { type: 'string' }])),
              required: f.itemFields,
              additionalProperties: false,
            },
          }
        : f.type === 'array'
          ? { type: 'array', items: { type: 'string' } }
          : { type: ['string', 'null'] },
    ])),
    required: fields.map(f => f.key),
    additionalProperties: false,
  };
}

export const ANALYSIS_SCHEMA = buildSchema(ANALYSIS_FIELDS);
export const COACHING_SCHEMA = buildSchema(COACHING_FIELDS);

export const fieldsForKind = (kind) => (normalizeKind(kind) === 'coaching' ? COACHING_FIELDS : ANALYSIS_FIELDS);
export const schemaForKind = (kind) => (normalizeKind(kind) === 'coaching' ? COACHING_SCHEMA : ANALYSIS_SCHEMA);
```

Replace `itemToText` with:

```js
export function itemToText(item) {
  if (item == null) return '';
  if (typeof item === 'string') return item.trim();
  if (typeof item === 'object') {
    const s = k => (typeof item[k] === 'string' ? item[k].trim() : '');
    if (s('goal')) {
      const status = GOAL_STATUS_LABELS[item.status];
      return [s('goal'), status && `(${status})`, s('progress') && `— ${s('progress')}`].filter(Boolean).join(' ');
    }
    const head = s('obstacle') || s('task');
    const due  = s('due');
    const main = head && due ? `${head} (${due})` : head;
    const ctx  = s('context');
    if (main && ctx) return `${main} — ${ctx}`;
    return main || ctx || '';
  }
  return String(item);
}
```

Change `analysisToText` to take the kind:

```js
export function analysisToText(ai, kind) {
  if (!ai || typeof ai !== 'object') return '';
  const blocks = [];
  for (const { key, label } of [...fieldsForKind(kind), ...LEGACY_ANALYSIS_FIELDS]) {
```

The rest of the function body is unchanged.

In `src/lib/sessionHomework.js`, replace `proposedTasks` and `describeTask`:

```js
export function proposedTasks(analysis) {
  const raw = analysis?.homework;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(item => (typeof item === 'string'
      ? { task: item, context: '' }
      : { task: item?.task, context: item?.context, due: item?.due }))
    .filter(x => typeof x.task === 'string' && x.task.trim())
    .map(x => {
      const due = typeof x.due === 'string' ? x.due.trim().slice(0, 80) : '';
      return {
        task:    x.task.trim().slice(0, 200),
        context: typeof x.context === 'string' ? x.context.trim().slice(0, 300) : '',
        // Only a coaching step has a due date, and only when one was said out
        // loud; a therapy practice keeps exactly the shape it always had.
        ...(due ? { due } : {}),
      };
    });
}
```

```js
// The description stored alongside a task: the "why", the agreed deadline if
// there was one, plus where it came from. Written at creation time so the
// Homework page can show provenance without resolving a session it may no
// longer be able to read. The deadline stays text ("by Friday"): turning it
// into a date would mean guessing which Friday.
export function describeTask(task, sessionTitle) {
  const from = sessionTitle ? `From "${sessionTitle}"` : 'From a session';
  const reason = [task.context, task.due ? `Due: ${task.due}` : ''].filter(Boolean).join('\n');
  return reason ? `${reason}\n\n${from}` : from;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests. Existing `ANALYSIS_SCHEMA` tests are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analysisFormat.js src/lib/sessionHomework.js tests/analysis.test.js tests/sessionHomework.test.js
git commit -m "feat(coaching): analysis shape for goals, steps, obstacles and insights"
```

---

### Task 5: Coaching prompt and the analyse route

**Files:**
- Create: `src/lib/coachingPrompt.js`
- Modify: `src/app/api/analyze/route.js`
- Test: `tests/coachingPrompt.test.js`

**Interfaces:**
- Consumes:
  - `normalizeKind` (Task 1)
  - `normalizeGoals` (Task 3)
  - `schemaForKind` (Task 4)
- Produces:
  - `coachingPrompt({ transcript, notes?, previousGoals?, languageDirective? }): string`
  - `POST /api/analyze` accepts `{ transcript, notes, session_id, kind, previous_goals }`

- [ ] **Step 1: Write the failing test**

Create `tests/coachingPrompt.test.js`:

```js
// The coaching prompt is where "goals carry over" actually happens: the model is
// told what the goals were and asked what became of them. These tests pin that
// the previous goals, the rules and the transcript all reach it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { coachingPrompt } from '../src/lib/coachingPrompt.js';

const base = { transcript: 'Coach: What will you do by Friday?\nClient: Email two clients.' };

test('the transcript and the language directive reach the prompt', () => {
  const p = coachingPrompt({ ...base, languageDirective: 'CRITICAL: Russian.' });
  assert.match(p, /Email two clients\./);
  assert.ok(p.trimEnd().endsWith('CRITICAL: Russian.'));
});

test('previous goals are handed over as JSON with the instruction to compare', () => {
  const p = coachingPrompt({ ...base, previousGoals: [{ goal: 'Launch the course', status: 'in_progress', progress: 'outline' }] });
  assert.match(p, /"goal": "Launch the course"/);
  assert.match(p, /previous coaching session/i);
  assert.doesNotMatch(p, /first analysed coaching session/i);
});

test('with no previous goals every goal is new', () => {
  const p = coachingPrompt(base);
  assert.match(p, /first analysed coaching session/i);
  assert.match(p, /"new"/);
});

test('notes are included only when there are some', () => {
  assert.match(coachingPrompt({ ...base, notes: 'Bring pricing' }), /Session notes:\nBring pricing/);
  assert.doesNotMatch(coachingPrompt({ ...base, notes: '  ' }), /Session notes:/);
});

test('the rules the spec requires are in the prompt', () => {
  const p = coachingPrompt(base);
  assert.match(p, /SAME language as the transcript/);
  assert.match(p, /actually agreed/i);
  assert.match(p, /never diagnose/i);
  assert.match(p, /empty array is better/i);
  for (const key of ['goals', 'homework', 'obstacles', 'insights', 'for_next_session', 'topics_covered', 'overview']) {
    assert.match(p, new RegExp(`"${key}"`), `prompt must describe ${key}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/coachingPrompt.test.js`
Expected: FAIL. Error: `Cannot find module '.../src/lib/coachingPrompt.js'`

- [ ] **Step 3: Implement**

Create `src/lib/coachingPrompt.js`:

```js
// The prompt for analysing a coaching session. The therapy prompt stays in the
// route untouched; this one differs in what it looks for — where the person is
// heading and what they agreed to do — and in being handed the goals from the
// previous coaching session, which is what lets progress be tracked at all.
//
// A pure function so the parts that matter (previous goals, the rules) can be
// tested without calling the model.

export function coachingPrompt({ transcript, notes = '', previousGoals = [], languageDirective = '' }) {
  const prior = Array.isArray(previousGoals) && previousGoals.length
    ? `Goals as they stood after the previous coaching session (JSON):\n${JSON.stringify(previousGoals, null, 1)}\n\nFor each of these, decide from THIS transcript whether it is "in_progress", "changed" (reworded or re-scoped), "achieved" or "dropped" (set aside). If a goal is not mentioned at all, keep it "in_progress" with progress "not discussed this session". Add any goal raised for the first time as "new".`
    : 'This is the first analysed coaching session: there are no previous goals, so every goal you find has status "new".';

  return `You are a thorough, supportive coaching session analyst. Analyse the ENTIRE coaching session transcript below — read through to the end and give every major topic equal attention.

${prior}

Return a JSON object with EXACTLY these fields. Return an empty array [] when a section genuinely has nothing.

- "topics_covered": array of strings — every distinct topic discussed, one short line each, in the order they arose
- "overview": array of strings — a 2-3 sentence summary for EACH major topic
- "goals": array of objects {"goal": string, "status": "new" | "in_progress" | "changed" | "achieved" | "dropped", "progress": string} — what the person is working towards, with one sentence on what this session showed about it
- "homework": array of objects {"task": string, "due": string or null, "context": string} — the next steps
  * Only steps that were actually agreed in the session. Never invent a step the person did not commit to.
  * "due": the deadline exactly as it was said ("by Friday", "before the next session"), or null if none was said. Do not convert it to a date.
  * "context": one sentence naming what in the session the step came from.
  * Tone: direct and concrete, never pushy. These are the person's own commitments.
- "obstacles": array of objects {"obstacle": string, "context": string} — what is getting in the way: beliefs, fears, lack of time or resources — grounded in what was said
- "insights": array of strings — realisations the person reached, and powerful questions the coach asked that are worth coming back to
- "for_next_session": array of strings — threads explicitly left for next time, or questions still open

Rules:
- Base every item strictly on the transcript. An empty array is better than a generic item like "stay motivated".
- If something heavy comes up — health, a crisis, grief — note it gently in "overview" and never diagnose. Coaching is not therapy; do not give clinical advice.
- IMPORTANT: Always respond in the SAME language as the transcript, in ALL fields and all array items.

Respond ONLY with valid JSON. No markdown, no explanation, no code fences.

Transcript:
${transcript}

${typeof notes === 'string' && notes.trim() ? `Session notes:\n${notes.trim()}` : ''}

${languageDirective}`;
}
```

In `src/app/api/analyze/route.js`:

Change the import `import { ANALYSIS_SCHEMA } from '@/lib/analysisFormat';` to:

```js
import { schemaForKind } from '@/lib/analysisFormat';
import { normalizeKind } from '@/lib/sessionKind';
import { normalizeGoals } from '@/lib/coachingGoals';
import { coachingPrompt } from '@/lib/coachingPrompt';
```

Replace the line `const { transcript, notes, session_id: sessionId = null } = await req.json();` with:

```js
    const {
      transcript, notes, session_id: sessionId = null,
      kind: rawKind, previous_goals: rawPreviousGoals,
    } = await req.json();
    const kind = normalizeKind(rawKind);
```

Rename the existing `const prompt = \`You are a compassionate, thorough therapy session analyst...` declaration to `const therapyPrompt = \`...`. Leave its content untouched. Directly after it, add:

```js
    const prompt = kind === 'coaching'
      ? coachingPrompt({
          transcript, notes,
          previousGoals: normalizeGoals(rawPreviousGoals),
          languageDirective: languageDirective(transcript),
        })
      : therapyPrompt;
```

In the request body, replace `schema: ANALYSIS_SCHEMA` with `schema: schemaForKind(kind)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests.

With the dev server running (`npm run dev` if it is not), run: `curl -s -X POST http://localhost:3000/api/analyze -H 'Content-Type: application/json' -d '{}'`
Expected: `{"error":"Not signed in."}`. This proves the route compiles under Next. A build error shows up as an HTML error page instead.

- [ ] **Step 5: Commit**

```bash
git add src/lib/coachingPrompt.js src/app/api/analyze/route.js tests/coachingPrompt.test.js
git commit -m "feat(coaching): analyse coaching sessions against the previous goals"
```

---

### Task 6: Sessions page

**Files:**
- Modify: `src/app/sessions/page.js`

**Interfaces:**
- Consumes:
  - `readLastKind`, `kindOf`, `normalizeKind`, `SESSION_KINDS`, `KIND_LABELS` (Task 1)
  - `topics.list(sb, {kind})`, `topics.save(..., {kind})`, `topics.archiveDiscussed(sb, {kind})`, `sessions.save({kind})`, `sessions.update(sb, id, {kind})` (Task 2)
  - `previousGoals`, `GOAL_STATUS_LABELS` (Task 3)
  - `fieldsForKind`, `analysisToText(ai, kind)` (Task 4)
  - `/api/analyze` body `{kind, previous_goals}` (Task 5)

This page has no unit tests. Each step is an exact edit, and Step 8 is a browser check.

- [ ] **Step 1: Imports**

Next to the existing imports at the top of `src/app/sessions/page.js`, add:

```js
import { readLastKind, kindOf, normalizeKind, SESSION_KINDS, KIND_LABELS } from '@/lib/sessionKind';
import { previousGoals, GOAL_STATUS_LABELS } from '@/lib/coachingGoals';
```

In the existing `@/lib/analysisFormat` import (around line 21), add `fieldsForKind` to the list.

- [ ] **Step 2: Save every new session with the chosen kind**

Add `kind: readLastKind(),` to all three `sessionsApi.save(supabase, { ... })` calls:
- in `createFromPaste` (around line 372), after `mood_before: null, mood_after: null,`;
- in the import flow (around line 746): `sessionsApi.save(supabase, { transcript: data.text || '', title: null, kind: readLastKind() })`;
- in `saveSession` (around line 827), after the `mood_after:` line.

- [ ] **Step 3: Topics of the session's kind**

In `openRecordModal`, change `topicsApi.list(supabase)` to `topicsApi.list(supabase, { kind: readLastKind() })`.

In `saveSession`, change `await topicsApi.archiveDiscussed(supabase);` to:

```js
        const archived = await topicsApi.archiveDiscussed(supabase, { kind: kindOf(result) });
```

This replaces the existing `const archived = ...` line. Do not duplicate it.

In `analyseSession`, change the auto-topic save to:

```js
          saved.push(await topicsApi.save(supabase, text, { source: 'ai', session_id: selectedSession.id, kind: kindOf(selectedSession) }));
```

- [ ] **Step 4: Analyse with kind and previous goals**

In `analyseSession`, replace the `body: JSON.stringify({ ... })` of the `/api/analyze` fetch with:

```js
        body: JSON.stringify({
          transcript: stripSpeakerMarkers(selectedSession.transcript),
          notes: selectedSession.notes,
          session_id: selectedSession.id,
          kind: kindOf(selectedSession),
          // Only meaningful for coaching; the route ignores it for therapy.
          previous_goals: kindOf(selectedSession) === 'coaching' ? previousGoals(sessions, selectedSession) : [],
        }),
```

After a successful analysis, clear the changed-kind hint added in Step 5: put `setKindChanged(false);` right after `setSelectedSession(withAI);`.

In `copySummary` (around line 1077), change `analysisToText(ai)` to `analysisToText(ai, kindOf(selectedSession))`.

- [ ] **Step 5: Change a session's kind**

Next to the other `useState` declarations near the top of the component, add:

```js
  // Set after the kind is switched: the summary on screen was written for the
  // other kind until the session is analysed again.
  const [kindChanged, setKindChanged] = useState(false);
  const [kindError,   setKindError]   = useState('');
```

At the start of `selectSession(s)`, before `if (showPaste ...`, add:

```js
    setKindChanged(false); setKindError('');
```

After `analyseSession`, add:

```js
  async function changeKind(kind) {
    const next = normalizeKind(kind);
    if (!selectedSession || kindOf(selectedSession) === next) return;
    setKindError('');
    try {
      await sessionsApi.update(supabase, selectedSession.id, { kind: next });
      setSelectedSession(s => ({ ...s, kind: next }));
      setSessions(list => list.map(s => (s.id === selectedSession.id ? { ...s, kind: next } : s)));
      setKindChanged(!!selectedSession.ai_analysis);
    } catch (e) {
      console.error('[Sessions] change kind:', e?.message);
      setKindError('Could not change the session type: ' + (e?.message || 'unknown error'));
    }
  }
```

In the session detail header, inside `<div style={{ flex: 1, minWidth: 0 }}>` and right after the `<p>` with the date, add:

```jsx
                    <div role="radiogroup" aria-label="Session type" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {SESSION_KINDS.map(k => {
                        const on = kindOf(selectedSession) === k;
                        return (
                          <button key={k} role="radio" aria-checked={on} onClick={() => changeKind(k)}
                            style={{ padding: '3px 11px', borderRadius: 999, border: `1px solid ${on ? A : BORDER}`, background: on ? A + '18' : 'transparent', color: on ? A : MUTED, fontSize: 11.5, fontWeight: on ? 600 : 500, cursor: on ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                            {KIND_LABELS[k]}
                          </button>
                        );
                      })}
                      {kindChanged && <span style={{ fontSize: 11.5, color: MUTED }}>Type changed — run Re-analyze to update the summary.</span>}
                      {kindError && <span style={{ fontSize: 11.5, color: '#DC2626' }}>{kindError}</span>}
                    </div>
```

- [ ] **Step 6: Kind label in the list, only when both kinds exist**

Next to where `grouped` is computed, add:

```js
  // A label on every row says nothing to someone who only records therapy.
  const mixedKinds = new Set(sessions.map(kindOf)).size > 1;
```

In the list row, inside the first flex `<div>` after the title `<p>`, add:

```jsx
                          {mixedKinds && (
                            <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 999, padding: '1px 7px', flexShrink: 0 }}>
                              {KIND_LABELS[kindOf(s)]}
                            </span>
                          )}
```

- [ ] **Step 7: Render the coaching sections**

In the Summary tab, replace `const SECTIONS = [...ANALYSIS_FIELDS, ...LEGACY_ANALYSIS_FIELDS];` with:

```js
                  const SECTIONS = [...fieldsForKind(kindOf(selectedSession)), ...LEGACY_ANALYSIS_FIELDS];
```

Replace the `{typeof item === 'string' ? item : ( <> {item?.task} ... </> )}` expression inside `<li>` with:

```jsx
                                    {typeof item === 'string' ? item : (
                                      // A practice, step, goal or obstacle carries the
                                      // reason it exists; the headline alone turns it
                                      // back into generic advice.
                                      <>
                                        {item?.task ?? item?.goal ?? item?.obstacle}
                                        {item?.status && GOAL_STATUS_LABELS[item.status] && (
                                          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 999, padding: '1px 7px' }}>
                                            {GOAL_STATUS_LABELS[item.status]}
                                          </span>
                                        )}
                                        {[item?.due && `Due: ${item.due}`, item?.progress, item?.context].filter(Boolean).length > 0 && (
                                          <span style={{ display: 'block', fontSize: 12.5, color: MUTED, marginTop: 3, lineHeight: 1.5 }}>
                                            {[item?.due && `Due: ${item.due}`, item?.progress, item?.context].filter(Boolean).join(' · ')}
                                          </span>
                                        )}
                                      </>
                                    )}
```

If `ANALYSIS_FIELDS` is no longer used anywhere in the file, remove it from the import. Check with `grep -n "ANALYSIS_FIELDS" src/app/sessions/page.js`.

- [ ] **Step 8: Verify in the browser**

Run `npm test`. Expected: all PASS.

Then, with the dev server on `http://localhost:3000` (`npm run dev` if it is not running), in a window wider than 800px:
1. Open `/sessions` and select any session. Expected: a Therapy/Coaching pill pair under the date, with Therapy selected.
2. Click Coaching on an analysed session. Expected: Coaching becomes selected, and the hint «Type changed — run Re-analyze…» appears. Before migration 023: an error message naming the `kind` column, and nothing else breaks.
3. Click Therapy again to restore the session.

- [ ] **Step 9: Commit**

```bash
git add src/app/sessions/page.js
git commit -m "feat(coaching): sessions page records, switches and renders the session kind"
```

---

### Task 7: Dashboard switch, Current goals, topics by kind

**Files:**
- Modify: `src/app/page.js`
- Modify: `src/components/NextSessionTopics.jsx`

**Interfaces:**
- Consumes:
  - `DEFAULT_KIND`, `SESSION_KINDS`, `KIND_LABELS`, `readLastKind`, `rememberKind` (Task 1)
  - `topics.list/save` with kind (Task 2)
  - `currentGoals`, `GOAL_STATUS_LABELS` (Task 3)
- Produces: `<NextSessionTopics kind={'therapy'|'coaching'} />`

- [ ] **Step 1: Topics component takes a kind**

In `src/components/NextSessionTopics.jsx`:
- Change the signature to `export default function NextSessionTopics({ kind = 'therapy' }) {`.
- In the loading effect, change `topicsApi.list(supabase)` to `topicsApi.list(supabase, { kind })`, and the dependency list `[supabase]` to `[supabase, kind]`.
- In `add()`, change `topicsApi.save(supabase, value)` to `topicsApi.save(supabase, value, { kind })`.
- In the hint around line 223, replace `Anything you want to raise with your therapist` with ``Anything you want to raise with your {kind === 'coaching' ? 'coach' : 'therapist'}``. Write it as JSX text with the expression inline.

- [ ] **Step 2: Dashboard state**

In `src/app/page.js` add imports:

```js
import { DEFAULT_KIND, SESSION_KINDS, KIND_LABELS, readLastKind, rememberKind } from '@/lib/sessionKind';
import { currentGoals, GOAL_STATUS_LABELS } from '@/lib/coachingGoals';
```

After `const [loading, setLoading] = useState(true);`, add:

```js
  // Starts at the default and reads the remembered choice after mount: reading
  // localStorage during render would make the server HTML and the first paint
  // disagree.
  const [kind,  setKind]  = useState(DEFAULT_KIND);
  const [goals, setGoals] = useState(null);
  useEffect(() => { setKind(readLastKind()); }, []);
```

Inside the `.then(([s, list, pairs, logs]) => {` callback, after `setEmotionLogs(logs);`, add:

```js
      setGoals(currentGoals(list));
```

- [ ] **Step 3: The switch**

In the Record card, directly before the `{/* Session name */}` input, add:

```jsx
            {/* Which kind of session is next. Remembered, so someone who only
                sees a coach chooses once. */}
            <div role="radiogroup" aria-label="Session type" style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
              {SESSION_KINDS.map(k => {
                const on = kind === k;
                return (
                  <button key={k} role="radio" aria-checked={on} onClick={() => setKind(rememberKind(k))}
                    style={{ padding: '6px 16px', borderRadius: 999, border: `1px solid ${on ? CORAL : BORDER}`, background: on ? CORAL + '18' : 'transparent', color: on ? CORAL : MUTED, fontSize: 12.5, fontWeight: on ? 600 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {KIND_LABELS[k]}
                  </button>
                );
              })}
            </div>
```

Replace `Tap to begin your therapy session` with `Tap to begin your {kind === 'coaching' ? 'coaching' : 'therapy'} session`, as JSX.

Replace `<NextSessionTopics />` with `<NextSessionTopics kind={kind} />`.

Replace the heading text `Your therapy journey at a glance` with `Your journey at a glance`.

- [ ] **Step 4: Current goals card**

Directly before `<NextSessionTopics kind={kind} />`, add:

```jsx
          {/* Goals from the latest analysed coaching session. Absent for anyone
              without one, rather than an empty card asking them to go coaching. */}
          {goals && (
            <section style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '13px 15px', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 9 }}>
                <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 400, color: TEXT, margin: 0 }}>Current goals</h2>
                <span style={{ fontSize: 11, color: MUTED }}>
                  from coaching on {new Date(goals.session.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
              {goals.goals.length === 0 ? (
                <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>No open goals — everything from your last coaching session is achieved or set aside.</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {goals.goals.map(g => (
                    <li key={g.goal} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 10px', background: BG, border: `1px solid ${BORDER}`, borderRadius: 9 }}>
                      <span style={{ fontSize: 13, color: TEXT, flex: 1, minWidth: 0, lineHeight: 1.45 }}>{g.goal}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 999, padding: '1px 8px', flexShrink: 0 }}>
                        {GOAL_STATUS_LABELS[g.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
```

- [ ] **Step 5: Verify in the browser**

Run `npm test`. Expected: all PASS.

At `http://localhost:3000/`, in a window wider than 800px:
1. Expected: a Therapy/Coaching switch above the session name, with Therapy selected. The caption says «therapy session». There is no Current goals card.
2. Click Coaching. Expected: the caption changes to «coaching session», and the topics list reloads (empty when there are no coaching topics). Reload the page: Coaching is still selected.
3. Click Therapy. Expected: the original topics are back.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.js src/components/NextSessionTopics.jsx
git commit -m "feat(coaching): dashboard session-type switch, current goals and topics by kind"
```

---

### Task 8: Homework page

**Files:**
- Modify: `src/app/homework/page.js`

**Interfaces:**
- Consumes: `kindOf`, `KIND_LABELS` (Task 1), `sessions.list` from `src/lib/api.js`.

- [ ] **Step 1: Load session kinds**

Change the api import to `import { homework as hwApi, sessions as sessionsApi } from '@/lib/api';` and add `import { kindOf, KIND_LABELS } from '@/lib/sessionKind';`.

After `const [error, setError] = useState('');`, add:

```js
  // Which kind each task's session was. Tasks carry only a session_id, so the
  // label is resolved against the session list; a failure just hides labels.
  const [kindBySession, setKindBySession] = useState({});
```

Replace the loading effect body with:

```js
    if (!supabase) return;
    hwApi.list(supabase).then(d => { setItems(d); setLoading(false); }).catch(() => setLoading(false));
    sessionsApi.list(supabase)
      .then(list => setKindBySession(Object.fromEntries(list.map(s => [s.id, kindOf(s)]))))
      .catch(e => console.error('[Homework] session kinds:', e?.message));
```

After that effect, add:

```js
  const mixedKinds = new Set(Object.values(kindBySession)).size > 1;
```

- [ ] **Step 2: Label and copy**

In the item rendering, directly inside the block that renders `d.from` (around line 122, `{(d.from || item.session_id) && (`), add this before that block:

```jsx
                      {mixedKinds && item.session_id && kindBySession[item.session_id] && (
                        <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 600, color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 999, padding: '1px 8px', marginBottom: 4 }}>
                          {KIND_LABELS[kindBySession[item.session_id]]}
                        </span>
                      )}
```

Replace `Therapy tasks and exercises` with `Tasks and steps from your sessions`.

Replace `Add your therapy homework above.` with `Add a task above.`.

- [ ] **Step 3: Verify**

Run `npm test`. Expected: all PASS.

Open `http://localhost:3000/homework`. Expected: the new subtitle, tasks listed as before, and no kind labels while all sessions are therapy.

- [ ] **Step 4: Commit**

```bash
git add src/app/homework/page.js
git commit -m "feat(coaching): homework shows which kind of session a task came from"
```

---

### Task 9: Patterns across both kinds

**Files:**
- Modify: `src/lib/patternsInput.js`, function `buildPatternsInput`
- Modify: `src/app/api/patterns/route.js`, prompt text
- Test: `tests/patterns.test.js`

**Interfaces:**
- Consumes: `kindOf` (Task 1), `normalizeGoals` (Task 3).
- Produces: `buildPatternsInput(...)` returns:
  - `therapy_sessions: number`
  - `coaching_sessions: number`
  - per session `type: 'therapy'|'coaching'`
  - for analysed coaching sessions: `goals: string[]`, `obstacles: string[]`, `insights: string[]`

- [ ] **Step 1: Write the failing test**

Append to `tests/patterns.test.js` (import `buildPatternsInput` if needed; it is already imported in this file):

```js
test('each session says whether it was therapy or coaching, and the totals are counted', () => {
  const input = buildPatternsInput([
    { created_at: '2026-01-01T10:00:00Z', ai_analysis: JSON.stringify({ topics_covered: ['сон'] }) },
    { created_at: '2026-02-01T10:00:00Z', kind: 'coaching', ai_analysis: JSON.stringify({
      topics_covered: ['курс'],
      goals: [{ goal: 'Запустить курс', status: 'in_progress', progress: 'план готов' }],
      obstacles: [{ obstacle: 'Страх оценки', context: 'дважды' }],
      insights: ['Откладываю, когда не уверена'],
    }) },
  ]);
  assert.equal(input.therapy_sessions, 1);
  assert.equal(input.coaching_sessions, 1);
  assert.deepEqual(input.sessions.map(s => s.type), ['therapy', 'coaching']);
  const coaching = input.sessions[1];
  assert.deepEqual(coaching.goals, ['Запустить курс (in_progress)']);
  assert.deepEqual(coaching.obstacles, ['Страх оценки']);
  assert.deepEqual(coaching.insights, ['Откладываю, когда не уверена']);
  assert.ok(!('goals' in input.sessions[0]), 'therapy entries do not grow empty coaching fields');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/patterns.test.js`
Expected: FAIL. `input.therapy_sessions` is `undefined`.

- [ ] **Step 3: Implement**

In `src/lib/patternsInput.js`, add imports:

```js
import { kindOf } from './sessionKind.js';
import { normalizeGoals } from './coachingGoals.js';
```

In `buildPatternsInput`:
- In the `entry` object literal, add `type: kindOf(s),` after `date: day(s.created_at),`.
- Inside `if (a) { ... }`, after `entry.for_next_session = list(a.for_next_session);`, add:

```js
      if (kindOf(s) === 'coaching') {
        entry.goals = list(normalizeGoals(a.goals).map(g => `${g.goal} (${g.status})`));
        entry.obstacles = list((Array.isArray(a.obstacles) ? a.obstacles : []).map(o => o?.obstacle));
        entry.insights = list(a.insights);
      }
```

In the returned object, after `analysed_sessions: analysed.length,`, add:

```js
    therapy_sessions: all.filter(s => kindOf(s) === 'therapy').length,
    coaching_sessions: all.filter(s => kindOf(s) === 'coaching').length,
```

In `src/app/api/patterns/route.js`, change the start of the prompt from `You are a thoughtful therapist reviewing a client's ENTIRE history across many sessions at once.` to:

```
You are a thoughtful reviewer of someone's ENTIRE history of therapy and coaching sessions at once.
```

After the sentence that ends `entries tagged "before"/"after" bracket a session.`, add:

```
Each session has a "type": "therapy" or "coaching" (${history.therapy_sessions ?? 0} therapy, ${history.coaching_sessions ?? 0} coaching). Coaching sessions also list goals with their status, obstacles and insights. When both types are present, look specifically for connections between them — a goal stalled in coaching and a fear explored in therapy can be the same thing — and name them in "recurring_themes" or "triggers".
```

In the rules list, change `Write for the client to read` to `Write for the person to read`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/patternsInput.js src/app/api/patterns/route.js tests/patterns.test.js
git commit -m "feat(coaching): patterns read therapy and coaching together and look for links"
```

---

### Task 10: Chat per kind

**Files:**
- Create: `src/lib/chatPrompts.js`
- Modify: `src/components/SuggestionList.jsx`
- Modify: `src/app/sessions/page.js`, chat `systemPrompt` (around line 1038) and the two `<SuggestionList>` usages
- Modify: `src/app/ai-chat/page.js`, line 91 and line 176
- Modify: `src/app/api/chat/route.js`, default `system`
- Modify: `src/lib/chatPresets.js`, lines 20, 78 and 105
- Test: `tests/chatPrompts.test.js`

**Interfaces:**
- Consumes: `normalizeKind` (Task 1), `CHAT_SUGGESTIONS` from `chatPresets.js`.
- Produces:
  - `sessionChatIntro({ kind, transcript? }): string`
  - `GENERAL_CHAT_INTRO: string`
  - `COACHING_SUGGESTIONS: string[]`
  - `suggestionsForKind(kind): string[]`
  - `<SuggestionList suggestions={string[]} ... />`

- [ ] **Step 1: Write the failing test**

Create `tests/chatPrompts.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/chatPrompts.test.js`
Expected: FAIL. Error: `Cannot find module '.../src/lib/chatPrompts.js'`

- [ ] **Step 3: Implement**

Create `src/lib/chatPrompts.js`:

```js
// How the AI introduces itself in a chat, by kind of session.
//
// Beside a coaching session the companion talks about goals and next steps; a
// therapy voice there — "what emotions came up?" — misses what the person came
// for. The standalone chat has no session, so it names both.

import { normalizeKind } from './sessionKind.js';
import { CHAT_SUGGESTIONS } from './chatPresets.js';

const INTRO = {
  therapy: 'You are a compassionate AI therapy companion. Be concise, warm, and insightful.',
  coaching: 'You are a supportive AI coaching companion. Help the person get clear on their goals, the next concrete step, and what is in the way. Ask one good question rather than giving a lecture. Be concise, direct and encouraging.',
};

export const GENERAL_CHAT_INTRO =
  'You are a compassionate AI companion for someone working with a therapist or a coach. Be concise, warm, and insightful.';

export function sessionChatIntro({ kind, transcript } = {}) {
  const k = normalizeKind(kind);
  const text = typeof transcript === 'string' ? transcript.trim() : '';
  if (!text) return INTRO[k];
  const label = k === 'coaching' ? 'a coaching session' : 'a therapy session';
  return `${INTRO[k]}\n\nThe user is reviewing ${label}.\n\nSession transcript:\n"${text}"`;
}

export const COACHING_SUGGESTIONS = [
  'Where am I with my goals?',
  'What did I commit to, and by when?',
  "What's really stopping me from the next step?",
];

export const suggestionsForKind = (kind) =>
  (normalizeKind(kind) === 'coaching' ? [...COACHING_SUGGESTIONS, ...CHAT_SUGGESTIONS] : CHAT_SUGGESTIONS);
```

In `src/components/SuggestionList.jsx`, change the signature and the two lines using the list:

```jsx
export default function SuggestionList({ onPick, disabled = false, compact = false, suggestions = CHAT_SUGGESTIONS }) {
```

```jsx
  const visible = showAll ? suggestions : suggestions.slice(0, SUGGESTION_PREVIEW);
  const hidden  = suggestions.length - SUGGESTION_PREVIEW;
```

In `src/app/sessions/page.js`:
- Add `import { sessionChatIntro, suggestionsForKind } from '@/lib/chatPrompts';`.
- Replace the first element of the `systemPrompt` array (the `includeCtx ? \`You are a compassionate AI therapy companion...\` : '...'` expression) with:

```js
        sessionChatIntro({
          kind: kindOf(selectedSession),
          transcript: includeCtx ? stripSpeakerMarkers(selectedSession.transcript).slice(0, 3000) : null,
        }),
```

- Add `suggestions={suggestionsForKind(kindOf(selectedSession))}` to both `<SuggestionList compact ...>` usages (around lines 1734 and 1796).

In `src/app/ai-chat/page.js`:
- Add `import { GENERAL_CHAT_INTRO } from '@/lib/chatPrompts';`.
- Replace `'You are a compassionate AI therapy companion. Be concise, warm, and insightful.',` with `GENERAL_CHAT_INTRO,`.
- Replace `I'm your AI therapy companion. Share what's on your mind.` with `I'm your AI companion for therapy and coaching. Share what's on your mind.`

In `src/app/api/chat/route.js`, replace the default `'You are a compassionate AI therapy companion. Be concise, warm, and insightful.'` with `'You are a compassionate AI companion for someone working with a therapist or a coach. Be concise, warm, and insightful.'`.

In `src/lib/chatPresets.js`:
- line 20: `'What questions should I bring to my therapist?'` → `'What questions should I bring to my next session?'`
- line 78: `"this could be worth discussing with your therapist"` → `"this could be worth discussing with your therapist or coach"`
- line 105: `"if this resonates, it's worth talking through with your therapist"` → `"if this resonates, it's worth talking through with your therapist or coach"`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chatPrompts.js tests/chatPrompts.test.js src/components/SuggestionList.jsx src/app/sessions/page.js src/app/ai-chat/page.js src/app/api/chat/route.js src/lib/chatPresets.js
git commit -m "feat(coaching): the chat speaks coaching beside a coaching session"
```

---

### Task 11: Neutral copy, spec update, end-to-end check

**Files:**
- Modify: `src/app/layout.js:7-8`, `src/app/auth/page.js:154`, `src/app/journals/page.js:93`
- Modify: `docs/superpowers/specs/2026-09-14-coaching-sessions-design.md`

- [ ] **Step 1: Copy**

- `src/app/layout.js`: `title: 'Miru — Therapy Journal'` → `title: 'Miru — Session Journal'`; `description: 'Your private therapy companion'` → `description: 'Your private companion for therapy and coaching'`.
- `src/app/auth/page.js`: `Your private therapy companion` → `Your private companion for therapy and coaching`.
- `src/app/journals/page.js`: `Structured journaling for therapy` → `Structured journaling between sessions`.
- Keep both "Miru is not a replacement for therapy…" disclaimers as they are. They are safety text, not positioning.

Run: `grep -rniE "therap" src/app src/components src/lib --exclude-dir=api | grep -vE "^\S+:[0-9]+:\s*(//|\*|/\*)"`

Expected: only these remain:
- the two disclaimers;
- `INTRO.therapy` and the `'therapy'` kind strings;
- `therapyPrompt`;
- `KIND_LABELS`;
- the conditional captions from Tasks 7 and 10 (`coach' : 'therapist'`, `'coaching' : 'therapy'`);
- the `or coach` preset lines.

- [ ] **Step 2: Record the two agreed deviations in the spec**

In `docs/superpowers/specs/2026-09-14-coaching-sessions-design.md`:
- Replace item 3 of "## 2. Путь пользователя" with:
  `3. Recall-бот в интерфейсе не запускается (\`/api/recall/start\` нигде не вызывается), поэтому сессии от него сохраняются как терапия; тип меняется на странице сессии.`
- Replace the «**Темы (`src/components/NextSessionTopics.jsx`):**» bullet block with:
  `**Темы (\`src/components/NextSessionTopics.jsx\`):** показывают и добавляют темы того типа, что выбран переключателем на дашборде. Отдельных вкладок нет — это был бы второй переключатель того же выбора. Архив прошлых тем общий.`

- [ ] **Step 3: Full test run**

Run: `npm test`
Expected: PASS, all tests. Before this plan there were 254; the plan adds about 45.

- [ ] **Step 4: End-to-end check (needs the user)**

Ask the user to run `supabase/migrations/023_session_kind.sql` in the Supabase SQL editor. Then, on `http://localhost:3000` in a window wider than 800px:
1. Dashboard → Coaching → record, or paste on `/sessions`, a 2–3 minute coaching conversation that contains a goal and an agreed step with a deadline.
2. `/sessions` → the new session shows **Coaching** → Analyse. Expected: GOALS (statuses «New»), NEXT STEPS with «Due: …», OBSTACLES, INSIGHTS, FOR NEXT SESSION.
3. `/homework`: the step is there with «Due: …» in its description.
4. Dashboard: a Current goals card with those goals. With Coaching selected, the topics block lists the FOR NEXT SESSION items.
5. Record a second coaching conversation that reports progress on the goal → Analyse. Expected: the goal's status is «In progress», «Changed» or «Achieved», not «New».
6. On a therapy session, Analyse still returns the familiar therapy sections.

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.js src/app/auth/page.js src/app/journals/page.js docs/superpowers/specs/2026-09-14-coaching-sessions-design.md
git commit -m "chore(copy): neutral wording for therapy and coaching; record plan deviations in the spec"
```
