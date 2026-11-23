// "Download my data": everything Kevi holds about the signed-in person, as one
// JSON file (GDPR Art. 15 and 20). Runs in the browser with the person's own
// session, so row-level security decides what is read — nothing here can
// reach another account's rows.
//
// Audio is listed, not embedded: recordings can be gigabytes. The list says
// what exists so it can be asked for.

import { AUDIO_BUCKET } from './audioStorage.js';

export const EXPORT_TABLES = [
  'sessions', 'homework', 'next_session_topics', 'ai_chats',
  'diary_entries', 'journal_entries', 'custom_journal_types', 'emotion_logs',
  'subscriptions', 'free_trials', 'user_quota', 'usage_events',
];

export async function collectMyData(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const out = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email, created_at: user.created_at },
    note: 'Everything Kevi stores about your account. Audio recordings are listed under audio_files; to receive the audio itself, write to hi@kevi.online.',
    tables: {},
    errors: {},
  };

  for (const table of EXPORT_TABLES) {
    try {
      const { data, error } = await supabase.from(table).select('*').eq('user_id', user.id);
      if (error) throw error;
      out.tables[table] = data ?? [];
    } catch (e) {
      out.errors[table] = e?.message || 'could not be read';
    }
  }

  try {
    const { data, error } = await supabase.storage.from(AUDIO_BUCKET).list(user.id, { limit: 1000 });
    if (error) throw error;
    out.audio_files = (data ?? []).map(f => ({ name: f.name, size_bytes: f.metadata?.size ?? null, created_at: f.created_at }));
  } catch (e) {
    out.errors.audio_files = e?.message || 'could not be listed';
  }

  if (Object.keys(out.errors).length === 0) delete out.errors;
  return out;
}

export function exportFileName(now = new Date()) {
  return `kevi-my-data-${now.toISOString().slice(0, 10)}.json`;
}
