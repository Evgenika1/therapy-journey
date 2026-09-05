// Topics you want to raise with your therapist, and how they reach a session.
//
// Pure functions: no React, no network. The formatting matters enough to pin
// down — these lines are prefilled into a real session's notes, on top of
// whatever the user may have already typed, so "when do we write, and exactly
// what" is not something to decide inline at the call site.

// Unchecked first and unchecked only: a topic already marked discussed has
// served its purpose and should not come back in the next session's notes.
export function pendingTopics(topics = []) {
  return (Array.isArray(topics) ? topics : [])
    .filter(t => t && !t.checked && typeof t.text === 'string' && t.text.trim());
}

export function discussedTopics(topics = []) {
  return (Array.isArray(topics) ? topics : []).filter(t => t && t.checked);
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
