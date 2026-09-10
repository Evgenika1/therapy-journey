// Topics you want to raise with your therapist, and how they reach a session.
//
// Pure functions: no React, no network. The formatting matters enough to pin
// down — these lines are prefilled into a real session's notes, on top of
// whatever the user may have already typed, so "when do we write, and exactly
// what" is not something to decide inline at the call site.

import { normalizeTitle } from './sessionHomework.js';

// Unchecked first and unchecked only: a topic already marked discussed has
// served its purpose and should not come back in the next session's notes.
export function pendingTopics(topics = []) {
  return (Array.isArray(topics) ? topics : [])
    .filter(t => t && !t.checked && typeof t.text === 'string' && t.text.trim());
}

// The block that lands in a session's notes. A heading and bullets, because it
// is dropped into a free-text field the user keeps writing in — without the
// heading, their own first line would read as one of the topics.
export function topicsToNotes(topics = []) {
  const pending = pendingTopics(topics);
  if (!pending.length) return '';
  return 'To discuss:\n' + pending.map(t => `• ${t.text.trim()}`).join('\n');
}

// Prefill only into an empty field. Overwriting notes the user has already
// started is the one unrecoverable thing this feature could do — there is no
// undo on a textarea they are mid-sentence in.
export function prefillNotes(existingNotes, topics = []) {
  if (typeof existingNotes === 'string' && existingNotes.trim()) return existingNotes;
  return topicsToNotes(topics);
}

// ── topics proposed by the session analysis ──────────────────────────────────
//
// "for_next_session" is the analysis's list of threads left hanging. They are
// exactly what the Dashboard block is for, so they go in it — marked as the
// model's suggestion rather than something you wrote, and replaced rather than
// duplicated when the same session is analysed again.

export function aiTopics(analysis) {
  const raw = analysis?.for_next_session;
  const list = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
  return list
    .filter(x => typeof x === 'string' && x.trim())
    .map(x => x.trim().slice(0, 300));
}

// Same shape of decision as the homework reconciliation, and the same rule at
// its centre: a topic already ticked off is never deleted. Checking one is the
// user saying "raised it" — a re-analysis must not quietly undo that record.
export function reconcileTopics(existing = [], proposed = []) {
  const rows = (Array.isArray(existing) ? existing : []).filter(Boolean);
  const wanted = new Set(proposed.map(normalizeTitle));

  // Archived rows are the record of a session that already happened, so they
  // are exempt from both halves of the reconciliation: never deleted, and
  // never proposed again. They stay in `rows` — and therefore in `present`
  // below — precisely so a re-analysis cannot resurrect one as a "new"
  // suggestion the user had already filed away.
  const toDelete = rows
    .filter(r => r.id != null && !r.checked && !r.archived && !wanted.has(normalizeTitle(r.text)))
    .map(r => r.id);

  const present = new Set(rows.map(r => normalizeTitle(r.text)));
  const toInsert = proposed.filter(t => !present.has(normalizeTitle(t)));

  return { toInsert, toDelete };
}

// ── the archive ──────────────────────────────────────────────────────────────
//
// Recording a session files away the topics it raised. What is left is a record
// worth reading — "this is what the 7th was about" — and that only works if it
// is grouped by when things were filed. A flat list of forty ticked-off lines
// is not a record, it is a heap.
//
// `source` tells the caller which date it got. Rows archived before migration
// 020 have no archived_at, and created_at — when the thought was first captured,
// often weeks earlier — must not be presented as the day it was archived. One
// unstamped row in a day makes the whole heading unprovable, so the group makes
// the weaker claim rather than a confident wrong one.
export function groupArchivedByDate(topics = []) {
  const rows = (Array.isArray(topics) ? topics : [])
    .filter(t => t && typeof t.text === 'string' && t.text.trim());

  const groups = new Map();
  for (const t of rows) {
    const stamp = t.archived_at ?? t.created_at ?? null;
    const date = stamp ? String(stamp).slice(0, 10) : null;
    if (!groups.has(date)) groups.set(date, { date, source: 'archived_at', items: [] });
    const group = groups.get(date);
    if (!t.archived_at) group.source = 'created_at';
    group.items.push(t);
  }

  const at = t => Date.parse(t.archived_at ?? t.created_at ?? 0) || 0;
  for (const group of groups.values()) group.items.sort((a, b) => at(b) - at(a));

  // Newest day first; the undated group trails, since there is nowhere in the
  // order it could honestly sit.
  return [...groups.values()].sort((a, b) => {
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });
}
