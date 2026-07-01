'use client';
import { useState, useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { diary as diaryApi } from '@/lib/api';

const MOODS = ['😞','😟','😐','🙂','😊'];

export default function DiaryPage() {
  const { supabase } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL: A } = useTheme();
  const [entries, setEntries] = useState([]);
  const [content, setContent] = useState('');
  const [mood,    setMood]    = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(true);
  const [editId,  setEditId]  = useState(null);
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    if (!supabase) return;
    diaryApi.list(supabase).then(d => { setEntries(d); setLoading(false); }).catch(() => setLoading(false));
  }, [supabase]);

  async function save() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const entry = await diaryApi.save(supabase, { content, mood });
      setEntries(e => [entry, ...e]);
      setContent(''); setMood(null);
    } finally { setSaving(false); }
  }

  async function saveEdit(id) {
    try {
      const updated = await diaryApi.update(supabase, id, { content: editContent });
      setEntries(e => e.map(x => x.id === id ? { ...x, content: editContent } : x));
      setEditId(null);
    } catch (err) { console.error(err?.message); }
  }

  async function del(id) {
    if (!confirm('Delete this entry?')) return;
    await diaryApi.delete(supabase, id);
    setEntries(e => e.filter(x => x.id !== id));
  }

  return (
    <AppLayout>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: BG, fontFamily: '"Plus Jakarta Sans", sans-serif', color: TEXT, paddingBottom: 60 }}>
        <div style={{ padding: 32, maxWidth: 740, margin: '0 auto' }}>
          <div style={{ marginBottom: 32 }}>
            <h1 style={{ fontFamily: '"Fraunces", serif', fontSize: 32, fontWeight: 300, color: TEXT, margin: '0 0 4px' }}>Diary</h1>
            <p style={{ fontSize: 15, color: MUTED, margin: 0 }}>A private space for your thoughts</p>
          </div>

          {/* New entry */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 24, marginBottom: 28 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {MOODS.map((e, i) => (
                <button key={i} onClick={() => setMood(i === mood ? null : i)}
                  style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${mood === i ? A : BORDER}`, background: mood === i ? A + '18' : 'transparent', fontSize: 18, cursor: 'pointer' }}>
                  {e}
                </button>
              ))}
            </div>
            <textarea value={content} onChange={e => setContent(e.target.value)}
              placeholder="What's on your mind today?"
              style={{ width: '100%', boxSizing: 'border-box', minHeight: 120, padding: '12px 16px', borderRadius: 10, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 15, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.7 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={save} disabled={!content.trim() || saving}
                style={{ padding: '10px 28px', borderRadius: 10, border: 'none', background: content.trim() ? A : BORDER, color: '#fff', fontSize: 14, fontWeight: 500, cursor: content.trim() ? 'pointer' : 'default' }}>
                {saving ? 'Saving…' : 'Save Entry'}
              </button>
            </div>
          </div>

          {/* Entries */}
          {loading && <p style={{ color: MUTED }}>Loading…</p>}
          {!loading && entries.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <p style={{ fontFamily: '"Fraunces", serif', fontSize: 26, fontWeight: 300, color: TEXT, margin: '0 0 8px' }}>Nothing here yet</p>
              <p style={{ fontSize: 15, color: MUTED }}>Write your first diary entry above.</p>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {entries.map(entry => (
              <div key={entry.id} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 22 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {entry.mood != null && <span style={{ fontSize: 20 }}>{MOODS[entry.mood]}</span>}
                    <span style={{ fontSize: 12, color: MUTED }}>{new Date(entry.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => { setEditId(entry.id); setEditContent(entry.content || ''); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: MUTED, padding: '4px 8px' }}>✏️</button>
                    <button onClick={() => del(entry.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: MUTED, padding: '4px 8px' }}>🗑️</button>
                  </div>
                </div>
                {editId === entry.id ? (
                  <div>
                    <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', minHeight: 100, padding: '10px 14px', borderRadius: 10, border: `1px solid ${A}`, background: BG, color: TEXT, fontSize: 14, resize: 'vertical', outline: 'none', fontFamily: 'inherit' }} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button onClick={() => setEditId(null)}
                        style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={() => saveEdit(entry.id)}
                        style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: A, color: '#fff', fontSize: 13, cursor: 'pointer' }}>Save</button>
                    </div>
                  </div>
                ) : (
                  <p style={{ fontSize: 15, color: TEXT, margin: 0, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{entry.content}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
