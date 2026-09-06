// Turning an analysis into homework rows, and re-running that without making a
// mess of what is already there.
//
// Pure functions: no React, no network. Re-analysing a session is a normal
// thing to do — the transcript gets edited, the model gets better — and each
// run proposes a fresh set. Deciding what to insert and what to remove is the
// part worth pinning down, because getting it wrong either doubles the list or
// deletes work the user has already done.

// Practices proposed by the analysis, in the object shape the model returns.
// Anything without a usable task is dropped rather than saved as a blank row.
export function proposedTasks(analysis) {
  const raw = analysis?.homework;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(item => (typeof item === 'string'
      ? { task: item, context: '' }
      : { task: item?.task, context: item?.context }))
    .filter(x => typeof x.task === 'string' && x.task.trim())
    .map(x => ({
      task:    x.task.trim().slice(0, 200),
      context: typeof x.context === 'string' ? x.context.trim().slice(0, 300) : '',
    }));
}

// Titles are compared loosely: the model rarely returns a character-identical
// string twice, and near-identical wording should still count as the same task
// rather than arriving as a second row.
export const normalizeTitle = (t) =>
  String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// What to change for one session, given what is already stored and what this
// run proposes.
//
// The rule that matters: a completed task is never deleted. It is a record that
// the user did something, and no re-analysis is worth destroying that. An
// incomplete auto-created task that the analysis no longer proposes is stale,
// so it goes; anything the user made themselves (no session_id) is untouched.
export function reconcileHomework(existing = [], proposed = []) {
  const rows = (Array.isArray(existing) ? existing : []).filter(Boolean);
  const wanted = new Map(proposed.map(p => [normalizeTitle(p.task), p]));

  // A row with no id cannot be deleted — sending `undefined` to the delete call
  // would either error or, worse, match nothing silently and look like success.
  const toDelete = rows
    .filter(r => r.id != null && !r.completed && !wanted.has(normalizeTitle(r.title)))
    .map(r => r.id);

  const present = new Set(rows.map(r => normalizeTitle(r.title)));
  const toInsert = proposed.filter(p => !present.has(normalizeTitle(p.task)));

  const kept = rows.filter(r => !toDelete.includes(r.id));

  return { toInsert, toDelete, kept };
}

// The description stored alongside a task: the "why", plus where it came from.
// Written at creation time so the Homework page can show provenance without
// having to resolve a session it may no longer be able to read.
export function describeTask(task, sessionTitle) {
  const from = sessionTitle ? `From "${sessionTitle}"` : 'From a session';
  return task.context ? `${task.context}\n\n${from}` : from;
}
