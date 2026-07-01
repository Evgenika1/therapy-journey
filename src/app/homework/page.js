'use client';
import { useState, useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { homework as hwApi } from '@/lib/api';

export default function HomeworkPage() {
  const { supabase } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL: A } = useTheme();
  const [items,   setItems]   = useState([]);
  const [title,   setTitle]   = useState('');
  const [desc,    setDesc]    = useState('');
  const [due,     setDue]     = useState('');
  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    hwApi.list(supabase).then(d => { setItems(d); setLoading(false); }).catch(() => setLoading(false));
  }, [supabase]);

  async function add() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const item = await hwApi.save(supabase, { title, description: desc, due_date: due || null });
      setItems(i => [item, ...i]);
      setTitle(''); setDesc(''); setDue('');
    } finally { setSaving(false); }
  }

  async function toggle(id, completed) {
    await hwApi.update(supabase, id, { completed: !completed });
    setItems(i => i.map(x => x.id === id ? { ...x, completed: !completed } : x));
  }

  async function del(id) {
    await hwApi.delete(supabase, id);
    setItems(i => i.filter(x => x.id !== id));
  }

  const pending = items.filter(i => !i.completed);
  const done    = items.filter(i => i.completed);

  return (
    <AppLayout>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: BG, fontFamily: '"Plus Jakarta Sans", sans-serif', color: TEXT, paddingBottom: 60 }}>
        <div style={{ padding: 32, maxWidth: 740, margin: '0 auto' }}>
          <div style={{ marginBottom: 32 }}>
            <h1 style={{ fontFamily: '"Fraunces", serif', fontSize: 32, fontWeight: 300, color: TEXT, margin: '0 0 4px' }}>Homework</h1>
            <p style={{ fontSize: 15, color: MUTED, margin: 0 }}>Therapy tasks and exercises</p>
          </div>

          {/* Add form */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 24, marginBottom: 28 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Task title…"
                style={{ padding: '11px 14px', borderRadius: 10, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 14, outline: 'none' }} />
              <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)…"
                style={{ padding: '11px 14px', borderRadius: 10, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 14, outline: 'none' }} />
              <div style={{ display: 'flex', gap: 10 }}>
                <input type="date" value={due} onChange={e => setDue(e.target.value)}
                  style={{ flex: 1, padding: '11px 14px', borderRadius: 10, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 14, outline: 'none' }} />
                <button onClick={add} disabled={!title.trim() || saving}
                  style={{ padding: '11px 28px', borderRadius: 10, border: 'none', background: title.trim() ? A : BORDER, color: '#fff', fontSize: 14, fontWeight: 500, cursor: title.trim() ? 'pointer' : 'default', flexShrink: 0 }}>
                  {saving ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
          </div>

          {loading && <p style={{ color: MUTED }}>Loading…</p>}

          {pending.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>To Do ({pending.length})</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pending.map(item => (
                  <div key={item.id} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                    <button onClick={() => toggle(item.id, item.completed)}
                      style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${BORDER}`, background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = A}
                      onMouseLeave={e => e.currentTarget.style.borderColor = BORDER} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 500, color: TEXT, margin: '0 0 2px' }}>{item.title}</p>
                      {item.description && <p style={{ fontSize: 13, color: MUTED, margin: '0 0 2px' }}>{item.description}</p>}
                      {item.due_date && <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>Due: {new Date(item.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>}
                    </div>
                    <button onClick={() => del(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, fontSize: 18, opacity: 0.5 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {done.length > 0 && (
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Completed ({done.length})</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {done.map(item => (
                  <div key={item.id} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, opacity: 0.55 }}>
                    <button onClick={() => toggle(item.id, item.completed)}
                      style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: A, color: '#fff', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, flexShrink: 0 }}>✓</button>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 15, color: MUTED, margin: 0, textDecoration: 'line-through' }}>{item.title}</p>
                    </div>
                    <button onClick={() => del(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, fontSize: 18, opacity: 0.5 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && items.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <p style={{ fontFamily: '"Fraunces", serif', fontSize: 26, fontWeight: 300, color: TEXT, margin: '0 0 8px' }}>No tasks yet</p>
              <p style={{ fontSize: 15, color: MUTED }}>Add your therapy homework above.</p>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
