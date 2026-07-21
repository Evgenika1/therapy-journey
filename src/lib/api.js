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
      .select()
      .single();
    if (error) throw toError(error);
    return data;
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

    let { data, error } = await supabase.from('emotion_logs').insert(insert).select().single();
    // Graceful fallback if migration 013 (sub_emotions column) hasn't run yet.
    if (error && (error.code === '42703' || error.code === 'PGRST204')) {
      delete insert.sub_emotions;
      ({ data, error } = await supabase.from('emotion_logs').insert(insert).select().single());
    }
    if (error) throw toError(error);
    return normalizeEmotion({ ...data, sub_emotions: data.sub_emotions ?? subEmotions });
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
  async forSession(supabase, sessionId) {
    const { data, error } = await supabase
      .from('homework')
      .select('id')
      .eq('session_id', sessionId)
      .limit(1);
    if (error) throw toError(error);
    return data?.[0] ?? null;
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
    const { data, error } = await supabase
      .from('homework')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
    if (error) throw toError(error);
    return {
      ...data,
      title:       fields.title       ?? data.title       ?? data.title_enc       ?? null,
      description: fields.description ?? data.description ?? data.description_enc ?? null,
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
    const { data, error } = await supabase
      .from('next_session_topics')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw toError(error);
    return data.map(t => ({
      ...t,
      text:    t.text    ?? t.text_enc ?? '',
      checked: t.checked ?? false,
    }));
  },

  async save(supabase, text) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('next_session_topics')
      .insert({ user_id: user.id, text })
      .select()
      .single();
    if (error) throw toError(error);
    return { ...data, text, checked: false };
  },

  async update(supabase, id, fields) {
    const { data: { user } } = await supabase.auth.getUser();
    const updates = {};
    if (fields.checked !== undefined) updates.checked = fields.checked;
    if (fields.text    !== undefined) updates.text    = fields.text;
    const { data, error } = await supabase
      .from('next_session_topics')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
    if (error) throw toError(error);
    return { ...data, text: fields.text ?? data.text ?? data.text_enc ?? '' };
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
