/**
 * Data access layer — all Supabase operations.
 * Data is protected by Supabase row-level security and server-side encryption at rest.
 */

// Normalizes an emotion_logs row into the shape the UI expects:
// `category`, `emotion_name` (display string) and a `sub_emotions` array.
// Handles both the new format (emotion = category, sub_emotions = [...])
// and the legacy format (emotion = "Category:emotion", no sub_emotions).
function normalizeEmotion(e) {
  const raw  = e.emotion ?? '';
  const subs = Array.isArray(e.sub_emotions) ? e.sub_emotions : [];
  let category, emotion_name;
  if (raw.includes(':')) {
    [category, emotion_name] = raw.split(':');
  } else {
    category     = raw || null;
    emotion_name = subs.length ? subs.join(', ') : (raw || null);
  }
  return { ...e, category, emotion_name, sub_emotions: subs };
}

// PostgREST answers an UPDATE that matched no row with PGRST116, "Cannot coerce
// the result to a single JSON object" — which then reaches the user verbatim
// and explains nothing. A zero-row update is not a coercion problem: the row is
// gone, or it belongs to someone else, or the filter is wrong. Say that.
function updatedRow(data, what) {
  if (data) return data;
  const err = new Error(`This ${what} could not be updated — it may have been deleted, or it belongs to another account. Reload and try again.`);
  err.code = 'NO_ROW';
  throw err;
}

// PostgREST reports an unknown column either as Postgres 42703 ("column \"note\"
// of relation ... does not exist") or as PGRST204 ("Could not find the 'note'
// column ... in the schema cache"). Both name the column in quotes.
const isMissingColumn = (e) => e?.code === '42703' || e?.code === 'PGRST204';

function missingColumnName(e) {
  const m = String(e?.message || '').match(/["'`]([a-z_][a-z0-9_]*)["'`]/i);
  return m ? m[1] : null;
}

function toError(supabaseError) {
  const msg = supabaseError?.message
    || supabaseError?.details
    || (typeof supabaseError === 'string' ? supabaseError : null)
    || JSON.stringify(supabaseError);
  const err = new Error(msg);
  err.code    = supabaseError?.code;
  err.details = supabaseError?.details;
  err.hint    = supabaseError?.hint;
  return err;
}

// ─── Sessions ─────────────────────────────────────────────────────────────────
export const sessions = {
  async list(supabase) {
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) throw toError(error);
    return data;
  },

  async save(supabase, session) {
    const { data: { user } } = await supabase.auth.getUser();
    console.log('[Save] auth user:', user?.id);
    if (!user) throw new Error('Not signed in — cannot save session.');
    const { data, error } = await supabase
      .from('sessions')
      .insert({
        user_id:     user.id,
        title:       session.title       || null,
        duration:    session.duration    ?? null,
        mood_before: session.mood_before ?? null,
        mood_after:  session.mood_after  ?? null,
        ai_analysis: session.ai_analysis || null,
        transcript:  session.transcript  || null,
        notes:       session.notes       || null,
      })
      .select();
    console.log('[Save] result data:', data, 'error:', error);
    if (error) throw toError(error);
    if (!data || data.length === 0) throw new Error('Session not saved — no row returned (RLS blocked the insert?).');
    return data[0];
  },

  // Save a session produced by a Recall.ai bot. We dedupe MANUALLY (select then
  // insert) rather than with `upsert({ onConflict: 'recall_bot_id' })` — that
  // requires a unique index on recall_bot_id, and without it Postgres errors
  // 42P10 ("no unique/exclusion constraint matching the ON CONFLICT spec") on
  // every call. Manual dedupe works whether or not migration 015's index exists.
  async saveFromRecall(supabase, { transcript, recall_bot_id, title = null, notes = null }) {
    const { data: { user } } = await supabase.auth.getUser();
    console.log('[Save/Recall] auth user:', user?.id, '| recall_bot_id:', recall_bot_id, '| transcript chars:', (transcript || '').length);
    if (!user) throw new Error('Not signed in — cannot save session.');

    // Already saved for this bot (e.g. a reload re-adopted it)? Return that row.
    const { data: existing, error: exErr } = await supabase
      .from('sessions')
      .select('*')
      .eq('recall_bot_id', recall_bot_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (exErr) throw toError(exErr);
    if (existing) { console.log('[Save/Recall] already saved:', existing.id); return existing; }

    const { data, error } = await supabase
      .from('sessions')
      .insert({ user_id: user.id, title, transcript: transcript || null, notes, recall_bot_id })
      .select();
    console.log('[Save/Recall] insert result data:', data, 'error:', error);
    if (error) throw toError(error);
    if (!data || data.length === 0) throw new Error('Session not saved — no row returned (RLS blocked the insert?).');
    return data[0];
  },

  async update(supabase, id, fields) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('sessions')
      .update(fields)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
    if (error) throw toError(error);
    return data;
  },

  async delete(supabase, id) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('sessions')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) throw toError(error);
  },

  async stats(supabase) {
    const { data, error } = await supabase
      .from('sessions')
      .select('mood_before, mood_after, ai_analysis')
      .is('deleted_at', null);
    if (error) throw toError(error);
    const total = data.length;
    const withMood = data.filter(s => s.mood_before != null && s.mood_after != null);
    const avgLift = withMood.length
      ? (withMood.reduce((acc, s) => acc + (s.mood_after - s.mood_before), 0) / withMood.length).toFixed(1)
      : null;
    const breakthroughs = data.filter(s => s.ai_analysis).length;
    return { total, avgLift, breakthroughs };
  },

  async moodPairs(supabase) {
    const { data, error } = await supabase
      .from('sessions')
      .select('id, created_at, mood_before, mood_after')
      .is('deleted_at', null)
      .not('mood_before', 'is', null)
      .not('mood_after', 'is', null)
      .order('created_at', { ascending: false });
    if (error) throw toError(error);
    return data.map(s => ({
      id:     s.id,
      day:    s.created_at?.slice(0, 10),
      before: s.mood_before,
      after:  s.mood_after,
      diff:   s.mood_after - s.mood_before,
    }));
  },
};

// ─── Diary ────────────────────────────────────────────────────────────────────
export const diary = {
  async list(supabase) {
    const { data, error } = await supabase
      .from('diary_entries')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw toError(error);
    return data.map(e => ({ ...e, content: e.content ?? e.content_encrypted ?? null }));
  },

  async save(supabase, entry) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('diary_entries')
      .insert({ user_id: user.id, mood: entry.mood, content: entry.content || null })
      .select()
      .single();
    if (error) throw toError(error);
    return { ...data, content: entry.content };
  },

  async update(supabase, id, fields) {
    const { data: { user } } = await supabase.auth.getUser();
    const updates = {};
    if (fields.mood    !== undefined) updates.mood    = fields.mood;
    if (fields.content !== undefined) updates.content = fields.content;
    const { data, error } = await supabase
      .from('diary_entries')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
    if (error) throw toError(error);
    return { ...data, content: fields.content };
  },

  async delete(supabase, id) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('diary_entries').delete().eq('id', id).eq('user_id', user.id);
    if (error) throw toError(error);
  },
};

// ─── Emotions ─────────────────────────────────────────────────────────────────
export const emotions = {
  async list(supabase) {
    const { data, error } = await supabase
      .from('emotion_logs')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw toError(error);
    return data.map(normalizeEmotion);
  },

  async save(supabase, log) {
    const { data: { user } } = await supabase.auth.getUser();
    const subEmotions = Array.isArray(log.sub_emotions) ? log.sub_emotions : [];
    // New multi-select rows store the category in `emotion` and the list in
    // `sub_emotions`. Legacy single-emotion callers (e.g. Session Before/After)
    // still pass emotion_name and keep the old "Category:emotion" encoding.
    const emotionValue = subEmotions.length
      ? (log.category || null)
      : (log.category && log.emotion_name
          ? `${log.category}:${log.emotion_name}`
          : (log.emotion_name || log.category || null));

    const insert = {
      user_id:      user.id,
      intensity:    log.intensity,
      emotion:      emotionValue,
      sub_emotions: subEmotions,
    };
    if (log.session_tag) insert.session_tag = log.session_tag;
    if (log.note?.trim()) insert.note = log.note.trim();

    // Columns added by later migrations (013 sub_emotions, 017 note) may not
    // exist yet on a database that hasn't been migrated. Rather than lose the
    // whole log, drop whichever column the error names and try again — the
    // emotion itself matters more than its optional extras.
    const dropped = [];
    let { data, error } = await supabase.from('emotion_logs').insert(insert).select().single();
    for (let i = 0; i < 2 && error && isMissingColumn(error); i++) {
      const column = missingColumnName(error);
      if (!column || !(column in insert)) break;
      delete insert[column];
      dropped.push(column);
      ({ data, error } = await supabase.from('emotion_logs').insert(insert).select().single());
    }
    if (error) throw toError(error);
    return normalizeEmotion({
      ...data,
      sub_emotions: data.sub_emotions ?? subEmotions,
      note: data.note ?? null,
      // Reported so the UI can say a note was not stored. Dropping it silently
      // would show the text once and lose it on the next load.
      dropped_columns: dropped,
    });
  },

  async update(supabase, id, fields) {
    const { data: { user } } = await supabase.auth.getUser();
    const updates = {};
    if (fields.intensity !== undefined) updates.intensity = fields.intensity;
    if (fields.emotion   !== undefined) updates.emotion   = fields.emotion;
    const { data, error } = await supabase
      .from('emotion_logs')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
    if (error) throw toError(error);
    return data;
  },

  async delete(supabase, id) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('emotion_logs').delete().eq('id', id).eq('user_id', user.id);
    if (error) throw toError(error);
  },
};

// ─── Homework ─────────────────────────────────────────────────────────────────
export const homework = {
  // Every row for one session, not just the first: re-analysing has to see the
  // whole set to know what is stale and what is already there.
  async listForSession(supabase, sessionId) {
    const { data, error } = await supabase
      .from('homework')
      .select('*')
      .eq('session_id', sessionId);
    if (error) throw toError(error);
    return data.map(h => ({
      ...h,
      title:       h.title       ?? h.title_enc       ?? null,
      description: h.description ?? h.description_enc ?? null,
    }));
  },

  async list(supabase) {
    const { data, error } = await supabase
      .from('homework')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw toError(error);
    return data.map(h => ({
      ...h,
      title:       h.title       ?? h.title_enc       ?? null,
      description: h.description ?? h.description_enc ?? null,
    }));
  },

  async save(supabase, item) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('homework')
      .insert({
        user_id:         user.id,
        due_date:        item.due_date,
        completed:       item.completed ?? false,
        session_id:      item.session_id ?? null,
        title_enc:       item.title       || null,
        description_enc: item.description || null,
      })
      .select()
      .single();
    if (error) throw toError(error);
    return { ...data, title: item.title, description: item.description };
  },

  async update(supabase, id, fields) {
    const { data: { user } } = await supabase.auth.getUser();
    const updates = {};
    if (fields.completed   !== undefined) updates.completed       = fields.completed;
    if (fields.due_date    !== undefined) updates.due_date        = fields.due_date;
    if (fields.session_id  !== undefined) updates.session_id      = fields.session_id;
    if (fields.title       !== undefined) updates.title_enc       = fields.title;
    if (fields.description !== undefined) updates.description_enc = fields.description;
    // Same zero-row trap as topics.update, and the same control behind it: the
    // checkbox on the Homework page.
    const { data, error } = await supabase
      .from('homework')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .maybeSingle();
    if (error) throw toError(error);
    const row = updatedRow(data, 'assignment');
    return {
      ...row,
      title:       fields.title       ?? row.title       ?? row.title_enc       ?? null,
      description: fields.description ?? row.description ?? row.description_enc ?? null,
    };
  },

  async delete(supabase, id) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('homework').delete().eq('id', id).eq('user_id', user.id);
    if (error) throw toError(error);
  },
};

// ─── Journals ─────────────────────────────────────────────────────────────────
export const journals = {
  async list(supabase, type) {
    let q = supabase.from('journal_entries').select('*').order('created_at', { ascending: false });
    if (type) q = q.eq('type', type);
    const { data, error } = await q;
    if (error) throw toError(error);
    return data.map(e => ({ ...e, content: e.content_encrypted }));
  },

  async save(supabase, entry) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('journal_entries')
      .insert({ user_id: user.id, type: entry.type, content_encrypted: entry.content || null })
      .select()
      .single();
    if (error) throw toError(error);
    return { ...data, content: entry.content };
  },

  async delete(supabase, id) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('journal_entries').delete().eq('id', id).eq('user_id', user.id);
    if (error) throw toError(error);
  },
};

// ─── Custom Journal Types ─────────────────────────────────────────────────────
export const customJournals = {
  async list(supabase) {
    const { data, error } = await supabase
      .from('custom_journal_types')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw toError(error);
    return data.map(d => ({ ...d, label: d.label ?? d.name ?? '' }));
  },

  async save(supabase, type) {
    const { data: { user } } = await supabase.auth.getUser();
    const { description: _desc, label, ...rest } = type;
    const { data, error } = await supabase
      .from('custom_journal_types')
      .insert({ user_id: user.id, name: label, ...rest })
      .select()
      .single();
    if (error) throw toError(error);
    return { ...data, label: data.name ?? label };
  },

  async delete(supabase, id) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('custom_journal_types').delete().eq('id', id).eq('user_id', user.id);
    if (error) throw toError(error);
  },
};

// ─── Next Session Topics ──────────────────────────────────────────────────────
export const topics = {
  async list(supabase) {
    // Only the live shortlist. Archived rows belong to sessions that already
    // happened — kept as the record of what was raised, but not what this block
    // is asking about. Migration 019 adds the column; without it there is
    // nothing archived yet, so an unfiltered query is the same answer.
    const query = () => supabase.from('next_session_topics').select('*').order('created_at', { ascending: true });
    let { data, error } = await query().eq('archived', false);
    if (error && isMissingColumn(error)) ({ data, error } = await query());
    if (error) throw toError(error);
    return data.map(t => ({
      ...t,
      text:    t.text    ?? t.text_enc ?? '',
      checked: t.checked ?? false,
      // Rows written before migration 018 have no source; they were all typed.
      source:  t.source  ?? 'manual',
    }));
  },

  // Every topic for one session — what re-analysing needs to see before it can
  // tell a stale suggestion from one that is still proposed.
  async listForSession(supabase, sessionId) {
    const { data, error } = await supabase
      .from('next_session_topics')
      .select('*')
      .eq('session_id', sessionId);
    // Before migration 018 there is no session_id to filter on. No column also
    // means no AI topics exist yet, so an empty list is the truthful answer.
    if (error) {
      if (isMissingColumn(error)) return [];
      throw toError(error);
    }
    return data.map(t => ({ ...t, text: t.text ?? t.text_enc ?? '', checked: t.checked ?? false }));
  },

  async save(supabase, text, meta = {}) {
    const { data: { user } } = await supabase.auth.getUser();
    const insert = { user_id: user.id, text };
    if (meta.source)     insert.source     = meta.source;
    if (meta.session_id) insert.session_id = meta.session_id;

    let { data, error } = await supabase.from('next_session_topics').insert(insert).select().single();

    // Migration 018 adds source and session_id. On a database that has not run
    // it, drop whichever column the error names and retry: a topic the user
    // just typed matters more than recording where it came from.
    for (let i = 0; i < 2 && error && isMissingColumn(error); i++) {
      const column = missingColumnName(error);
      if (!column || !(column in insert)) break;
      delete insert[column];
      ({ data, error } = await supabase.from('next_session_topics').insert(insert).select().single());
    }
    if (error) throw toError(error);
    return { ...data, text, checked: false, source: meta.source || 'manual' };
  },

  async update(supabase, id, fields) {
    const { data: { user } } = await supabase.auth.getUser();
    const updates = {};
    if (fields.checked !== undefined) updates.checked = fields.checked;
    if (fields.text    !== undefined) updates.text    = fields.text;
    // maybeSingle, not single: zero rows is a state to report, not an exception
    // to translate. Toggling a topic is the most-used control in this list and
    // it was failing with a PostgREST internal message.
    const { data, error } = await supabase
      .from('next_session_topics')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .maybeSingle();
    if (error) throw toError(error);
    const row = updatedRow(data, 'topic');
    return { ...row, text: fields.text ?? row.text ?? row.text_enc ?? '' };
  },

  // Recording a session files away the topics it raised: the block is "what to
  // bring next time", so it has to start empty again. Archiving, not deleting —
  // these rows are the record of what was actually discussed, and that is not
  // recoverable once dropped. Unticked topics are left alone: they were never
  // raised, so they carry over to the next session.
  async archiveDiscussed(supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    // The stamp is what the archive view groups by. Migration 020 may not have
    // run, so a missing archived_at drops to a plain archive rather than
    // failing — losing the date is recoverable, losing the archive is not.
    const updates = { archived: true, archived_at: new Date().toISOString() };
    const run = () => supabase
      .from('next_session_topics')
      .update(updates)
      .eq('user_id', user.id)
      .eq('checked', true)
      .eq('archived', false)
      .select();

    let { data, error } = await run();
    if (error && isMissingColumn(error) && 'archived_at' in updates) {
      delete updates.archived_at;
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

  // Ticking a topic off files it away, in one write. There used to be two
  // resting places for a finished topic — a "done" fold for checked rows and
  // the archive for archived ones — and a row could sit in the first forever.
  // With the fold gone, checked-but-not-archived is visible nowhere at all, so
  // the two flags are set together and never apart.
  async archive(supabase, id) {
    const { data: { user } } = await supabase.auth.getUser();
    const updates = { checked: true, archived: true, archived_at: new Date().toISOString() };
    const run = () => supabase
      .from('next_session_topics')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .maybeSingle();

    let { data, error } = await run();
    // Migration 020 may not have run; losing the date beats losing the archive.
    if (error && isMissingColumn(error) && 'archived_at' in updates) {
      delete updates.archived_at;
      ({ data, error } = await run());
    }
    if (error) throw toError(error);
    const filed = updatedRow(data, 'topic');
    return {
      ...filed,
      text:     filed.text ?? filed.text_enc ?? '',
      source:   filed.source ?? 'manual',
      checked:  true,
      archived: true,
    };
  },

  // The archive is read only when the user opens it, so this is a second query
  // rather than a wider first one: the Dashboard's hot path stays the short
  // live list.
  async listArchived(supabase) {
    const { data, error } = await supabase
      .from('next_session_topics')
      .select('*')
      .eq('archived', true)
      .order('created_at', { ascending: false });
    // No column means nothing has ever been archived — an empty archive is the
    // truthful answer, not an error to show the user.
    if (error) {
      if (isMissingColumn(error)) return [];
      throw toError(error);
    }
    return (data ?? []).map(t => ({
      ...t,
      text:    t.text ?? t.text_enc ?? '',
      source:  t.source ?? 'manual',
    }));
  },

  // Back into the live list, ready to be raised again. Un-checking matters as
  // much as un-archiving: an archived topic is checked by definition, and
  // leaving it so would drop it into the "done" fold rather than the list the
  // user restored it to.
  async restore(supabase, id) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('next_session_topics')
      .update({ archived: false, checked: false, archived_at: null })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .maybeSingle();
    if (error) throw toError(error);
    const restored = updatedRow(data, 'topic');
    return { ...restored, text: restored.text ?? restored.text_enc ?? '', checked: false, archived: false };
  },

  async delete(supabase, id) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('next_session_topics').delete().eq('id', id).eq('user_id', user.id);
    if (error) throw toError(error);
  },
};

// ─── AI Chats ─────────────────────────────────────────────────────────────────
export const aiChats = {
  async list(supabase) {
    const { data, error } = await supabase
      .from('ai_chats')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw toError(error);
    return data;
  },

  async create(supabase, title, messages, sessionId = null) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('ai_chats')
      .insert({ user_id: user.id, title, messages, session_id: sessionId })
      .select()
      .single();
    if (error) throw toError(error);
    return data;
  },

  async forSession(supabase, sessionId) {
    const { data, error } = await supabase
      .from('ai_chats')
      .select('*')
      .eq('session_id', sessionId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw toError(error);
    return data;
  },

  async update(supabase, id, messages) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('ai_chats')
      .update({ messages, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
    if (error) throw toError(error);
    return data;
  },

  async delete(supabase, id) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('ai_chats').delete().eq('id', id).eq('user_id', user.id);
    if (error) throw toError(error);
  },
};
