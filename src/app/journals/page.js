'use client';
import { useState, useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { journals as journalsApi, customJournals } from '@/lib/api';

const DEFAULT_TYPES = [
  { value: 'gratitude',   label: 'Gratitude',    icon: '🙏', color: '#F59E0B' },
  { value: 'reflection',  label: 'Reflection',   icon: '💭', color: '#8B5CF6' },
  { value: 'cbt',         label: 'CBT',          icon: '🧠', color: '#3B82F6' },
  { value: 'affirmation', label: 'Affirmations', icon: '✨', color: '#10B981' },
];

export default function JournalsPage() {
  const { supabase } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, BODY, CORAL: A } = useTheme();
  const [entries,     setEntries]     = useState([]);
  const [types,       setTypes]       = useState([]);
  const [activeType,  setActiveType]  = useState('gratitude');
  const [content,     setContent]     = useState('');
  const [saving,      setSaving]      = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [newLabel,    setNewLabel]    = useState('');
  const [addingType,  setAddingType]  = useState(false);

  useEffect(() => {
    if (!supabase) return;
    Promise.all([
      journalsApi.list(supabase, activeType),
      customJournals.list(supabase),
    ]).then(([e, ct]) => {
      setEntries(e);
      setTypes(ct);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [supabase, activeType]);

  async function save() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const entry = await journalsApi.save(supabase, { type: activeType, content });
      setEntries(e => [entry, ...e]);
      setContent('');
    } finally { setSaving(false); }
  }

  async function del(id) {
    if (!confirm('Delete this entry?')) return;
    await journalsApi.delete(supabase, id);
    setEntries(e => e.filter(x => x.id !== id));
  }

  async function addType() {
    if (!newLabel.trim()) return;
    const t = await customJournals.save(supabase, { label: newLabel.trim() });
    setTypes(ts => [...ts, t]);
    setNewLabel(''); setAddingType(false);
  }

  const allTypes = [
    ...DEFAULT_TYPES,
    ...types.map(t => ({ value: t.id, label: t.label, icon: t.icon || '📓', color: t.color || A })),
  ];
  const currentType = allTypes.find(t => t.value === activeType) || allTypes[0];

  return (
    <AppLayout>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: BG, fontFamily: '"Plus Jakarta Sans", sans-serif', color: TEXT, paddingBottom: 60 }}>
        <div style={{ padding: 32, maxWidth: 860, margin: '0 auto' }}>
          <div style={{ marginBottom: 32 }}>
            <h1 style={{ fontFamily: '"Fraunces", serif', fontSize: 32, fontWeight: 300, color: TEXT, margin: '0 0 4px' }}>Journals</h1>
            <p style={{ fontSize: 15, color: MUTED, margin: 0 }}>Structured journaling for therapy</p>
          </div>

          {/* Type selector */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
            {allTypes.map(t => (
              <button key={t.value} onClick={() => setActiveType(t.value)}
                style={{ padding: '8px 16px', borderRadius: 10, border: `1px solid ${activeType === t.value ? t.color : BORDER}`, background: activeType === t.value ? t.color + '15' : 'transparent', color: activeType === t.value ? t.color : MUTED, fontSize: 13, fontWeight: activeType === t.value ? 600 : 400, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{t.icon}</span>{t.label}
              </button>
            ))}
            {!addingType ? (
              <button onClick={() => setAddingType(true)}
                style={{ padding: '8px 14px', borderRadius: 10, border: `1px dashed ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 13, cursor: 'pointer' }}>
                + Add type
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Type name…" autoFocus
                  onKeyDown={e => e.key === 'Enter' && addType()}
                  style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${A}`, background: BG, color: TEXT, fontSize: 13, outline: 'none', width: 140 }} />
                <button onClick={addType} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: A, color: '#fff', fontSize: 13, cursor: 'pointer' }}>Add</button>
                <button onClick={() => setAddingType(false)} style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 13, cursor: 'pointer' }}>✕</button>
              </div>
            )}
          </div>

          {/* Write */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 24, marginBottom: 28 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: currentType?.color || A, margin: '0 0 12px' }}>{currentType?.icon} {currentType?.label}</p>
            <textarea value={content} onChange={e => setContent(e.target.value)}
              placeholder={`Write your ${currentType?.label?.toLowerCase() || 'journal'} entry…`}
              style={{ width: '100%', boxSizing: 'border-box', minHeight: 120, padding: '12px 16px', borderRadius: 10, border: `1px solid ${BORDER}`, background: BG, color: BODY, fontSize: 15, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.7 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={save} disabled={!content.trim() || saving}
                style={{ padding: '10px 28px', borderRadius: 10, border: 'none', background: content.trim() ? A : BORDER, color: '#fff', fontSize: 14, fontWeight: 500, cursor: content.trim() ? 'pointer' : 'default' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          {/* Entries */}
          {loading && <p style={{ color: MUTED }}>Loading…</p>}
          {!loading && entries.length === 0 && (
            <p style={{ color: MUTED, fontSize: 15 }}>No {currentType?.label?.toLowerCase()} entries yet.</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {entries.map(e => (
              <div key={e.id} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: MUTED }}>{new Date(e.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  <button onClick={() => del(e.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, fontSize: 14, opacity: 0.5, padding: '0 4px' }}>🗑️</button>
                </div>
                <p style={{ fontSize: 15, color: TEXT, margin: 0, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{e.content}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
