/**
 * Data access layer — all Supabase operations.
 * Data is protected by Supabase row-level security and server-side encryption at rest.
 */

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
    const { data, error } = await supabase
      .from('sessions')
      .update(fields)
      .eq('id', id)
      .select()
      .single();
    if (error) throw toError(error);
    return data;
  },

  async delete(supabase, id) {
    const { error } = await supabase
      .from('sessions')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw toError(error);
  },

  async stats(supabase) {
    const { data, error } = await supabase
      .from('sessions')
      .select('mood_before, mood_after, ai_analysis');
    if (error) throw toError(error);
    const total = data.length;
    const withMood = data.filter(s => s.mood_before != null && s.mood_after != null);
    const avgLift = withMood.length
      ? (withMood.reduce((acc, s) => acc + (s.mood_after - s.mood_before), 0) / withMood.length).toFixed(1)
      : null;
    const breakthroughs = data.filter(s => s.ai_analysis).length;
    return { total, avgLift, breakthroughs };
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
    const updates = {};
    if (fields.mood    !== undefined) updates.mood    = fields.mood;
    if (fields.content !== undefined) updates.content = fields.content;
    const { data, error } = await supabase
      .from('diary_entries')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw toError(error);
    return { ...data, content: fields.content };
  },

  async delete(supabase, id) {
    const { error } = await supabase.from('diary_entries').delete().eq('id', id);
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
    return data.map(e => {
      const raw = e.emotion ?? '';
      const [cat, emo] = raw.includes(':') ? raw.split(':') : [null, raw];
      return {
        ...e,
        category:     cat  || e.category     || null,
        emotion_name: emo  || e.emotion_name || null,
      };
    });
  },

  async save(supabase, log) {
    const { data: { user } } = await supabase.auth.getUser();
    const emotionValue = log.category && log.emotion_name
      ? `${log.category}:${log.emotion_name}`
      : (log.emotion_name || log.category || null);
    const insert = {
      user_id:   user.id,
      intensity: log.intensity,
      emotion:   emotionValue,
    };
    if (log.session_tag) insert.session_tag = log.session_tag;
    const { data, error } = await supabase
      .from('emotion_logs')
      .insert(insert)
      .select()
      .single();
    if (error) throw toError(error);
    return { ...data, category: log.category, emotion_name: log.emotion_name };
  },

  async todaySession(supabase) {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('emotion_logs')
      .select('*')
      .not('session_tag', 'is', null)
      .gte('created_at', `${today}T00:00:00.000Z`)
      .lt('created_at', `${today}T23:59:59.999Z`);
    if (error) {
      if (error.code === '42703' || error.code === 'PGRST204') return [];
      throw toError(error);
    }
    return data;
  },

  async sessionPairs(supabase) {
    const { data, error } = await supabase
      .from('emotion_logs')
      .select('*')
      .not('session_tag', 'is', null)
      .order('created_at', { ascending: false });
    if (error) {
      if (error.code === '42703' || error.code === 'PGRST204') return [];
      throw toError(error);
    }
    const byDay = {};
    for (const e of data) {
      const day = e.created_at?.slice(0, 10);
      if (!day) continue;
      if (!byDay[day]) byDay[day] = {};
      if (e.session_tag === 'before' || e.session_tag === 'after') byDay[day][e.session_tag] = e;
    }
    return Object.entries(byDay)
      .filter(([, v]) => v.before && v.after)
      .map(([day, v]) => ({ day, before: v.before, after: v.after, diff: v.after.intensity - v.before.intensity }))
      .sort((a, b) => b.day.localeCompare(a.day));
  },

  async update(supabase, id, fields) {
    const updates = {};
    if (fields.intensity !== undefined) updates.intensity = fields.intensity;
    if (fields.emotion   !== undefined) updates.emotion   = fields.emotion;
    const { data, error } = await supabase
      .from('emotion_logs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw toError(error);
    return data;
  },

  async delete(supabase, id) {
    const { error } = await supabase.from('emotion_logs').delete().eq('id', id);
    if (error) throw toError(error);
  },
};

// ─── Homework ─────────────────────────────────────────────────────────────────
export const homework = {
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
    const { error } = await supabase.from('homework').delete().eq('id', id);
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
    const { error } = await supabase.from('journal_entries').delete().eq('id', id);
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
    const { error } = await supabase.from('custom_journal_types').delete().eq('id', id);
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
    const updates = {};
    if (fields.checked !== undefined) updates.checked = fields.checked;
    if (fields.text    !== undefined) updates.text    = fields.text;
    const { data, error } = await supabase
      .from('next_session_topics')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw toError(error);
    return { ...data, text: fields.text ?? data.text ?? data.text_enc ?? '' };
  },

  async delete(supabase, id) {
    const { error } = await supabase.from('next_session_topics').delete().eq('id', id);
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

  async create(supabase, title, messages) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('ai_chats')
      .insert({ user_id: user.id, title, messages })
      .select()
      .single();
    if (error) throw toError(error);
    return data;
  },

  async update(supabase, id, messages) {
    const { data, error } = await supabase
      .from('ai_chats')
      .update({ messages, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw toError(error);
    return data;
  },

  async delete(supabase, id) {
    const { error } = await supabase.from('ai_chats').delete().eq('id', id);
    if (error) throw toError(error);
  },
};

// ─── User Settings ────────────────────────────────────────────────────────────
export const userSettings = {
  async get(supabase) {
    const { data, error } = await supabase
      .from('user_settings')
      .select('settings')
      .single();
    if (error && error.code !== 'PGRST116') throw toError(error);
    return data?.settings ?? {};
  },

  async set(supabase, key, value) {
    const current = await userSettings.get(supabase).catch(() => ({}));
    const updated = { ...current, [key]: value };
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('user_settings')
      .upsert({ user_id: user.id, settings: updated }, { onConflict: 'user_id' });
    if (error) throw toError(error);
    return updated;
  },
};
