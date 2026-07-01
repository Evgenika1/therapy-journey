'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { topics as topicsApi } from '@/lib/api';
import { useTheme } from '@/lib/ThemeContext';

function Countdown({ targetDate }) {
  const { CORAL: A, MUTED } = useTheme();
  const [diff, setDiff] = useState(null);

  useEffect(() => {
    if (!targetDate) return;
    function update() {
      const ms = new Date(targetDate) - new Date();
      if (ms <= 0) { setDiff({ days: 0, hours: 0, mins: 0 }); return; }
      const days  = Math.floor(ms / 86400000);
      const hours = Math.floor((ms % 86400000) / 3600000);
      const mins  = Math.floor((ms % 3600000) / 60000);
      setDiff({ days, hours, mins });
    }
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [targetDate]);

  if (!diff) return null;

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
      {[
        [diff.days,  'days'],
        [diff.hours, 'hours'],
        [diff.mins,  'mins'],
      ].map(([val, label]) => (
        <div key={label} style={{ textAlign: 'center' }}>
          <p style={{ fontFamily: '"Fraunces", serif', fontSize: 40, fontWeight: 300, color: A, margin: 0, lineHeight: 1, minWidth: 56 }}>{String(val).padStart(2, '0')}</p>
          <p style={{ fontSize: 11, color: MUTED, margin: '4px 0 0', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</p>
        </div>
      ))}
    </div>
  );
}

export default function NextSessionPage() {
  const { supabase } = useAuth();
  const { BG, BORDER, MUTED, SURFACE, CORAL: A, NAV_ACTIVE: ABG, H1: TEXT } = useTheme();
  const [topics,      setTopics]      = useState([]);
  const [newText,     setNewText]     = useState('');
  const [adding,      setAdding]      = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [clearing,    setClearing]    = useState(false);
  const [sessionDate, setSessionDate] = useState('');

  useEffect(() => {
    if (!supabase) return;
    topicsApi.list(supabase).then(l => { setTopics(l); setLoading(false); }).catch(err => console.error('[NextSession]', err?.message));
    const saved = localStorage.getItem('tj_next_session_date');
    if (saved) setSessionDate(saved);
  }, [supabase]);

  function handleDateChange(e) {
    setSessionDate(e.target.value);
    localStorage.setItem('tj_next_session_date', e.target.value);
  }

  async function addTopic() {
    if (!newText.trim()) return;
    setAdding(true);
    try {
      const topic = await topicsApi.save(supabase, newText.trim());
      setTopics(t => [...t, topic]);
      setNewText('');
    } finally { setAdding(false); }
  }

  async function toggleTopic(id, checked) {
    await topicsApi.update(supabase, id, { checked: !checked });
    setTopics(t => t.map(x => x.id === id ? { ...x, checked: !checked } : x));
  }

  async function deleteTopic(id) {
    await topicsApi.delete(supabase, id);
    setTopics(t => t.filter(x => x.id !== id));
  }

  async function clearAll() {
    if (!confirm('Clear all topics?')) return;
    setClearing(true);
    try {
      await Promise.all(topics.map(t => topicsApi.delete(supabase, t.id)));
      setTopics([]);
    } finally { setClearing(false); }
  }

  const pending = topics.filter(t => !t.checked);
  const done    = topics.filter(t => t.checked);

  return (
    <AppLayout>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: BG, fontFamily: '"Plus Jakarta Sans", sans-serif', color: TEXT, paddingBottom: 60 }}>
        <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>

          <div style={{ marginBottom: 32 }}>
            <h1 style={{ fontFamily: '"Fraunces", serif', fontSize: 32, fontWeight: 300, color: TEXT, margin: '0 0 4px', lineHeight: 1.2 }}>Next Session</h1>
            <p style={{ fontSize: 15, color: MUTED, margin: 0 }}>Prepare topics and questions for your therapist</p>
          </div>

          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20 }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Countdown</p>
                {sessionDate
                  ? <Countdown targetDate={sessionDate} />
                  : <p style={{ fontSize: 15, color: MUTED, margin: 0 }}>Set your next session date to see the countdown</p>
                }
              </div>
              <div>
                <p style={{ fontSize: 12, color: MUTED, margin: '0 0 6px', fontWeight: 500 }}>Next session date</p>
                <input type="datetime-local" value={sessionDate} onChange={handleDateChange}
                  style={{ padding: '9px 14px', borderRadius: 10, border: `1px solid ${BORDER}`, fontSize: 14, color: TEXT, background: BG, outline: 'none', cursor: 'pointer' }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 28 }}>
            <input value={newText} onChange={e => setNewText(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTopic()}
              placeholder="Add a topic or question for your therapist…"
              style={{ flex: 1, padding: '12px 16px', borderRadius: 10, border: `1px solid ${BORDER}`, fontSize: 15, color: TEXT, background: BG, outline: 'none' }}
              onFocus={e => e.target.style.borderColor = A}
              onBlur={e  => e.target.style.borderColor = BORDER}
            />
            <button onClick={addTopic} disabled={!newText.trim() || adding}
              style={{ padding: '12px 24px', borderRadius: 10, border: 'none', background: A, color: '#fff', fontSize: 15, fontWeight: 500, cursor: 'pointer', opacity: !newText.trim() ? 0.5 : 1, flexShrink: 0 }}>
              Add
            </button>
          </div>

          {loading && <p style={{ fontSize: 15, color: MUTED }}>Loading…</p>}

          {!loading && topics.length === 0 && (
            <div style={{ textAlign: 'center', padding: '80px 0' }}>
              <p style={{ fontFamily: '"Fraunces", serif', fontSize: 28, fontWeight: 300, color: TEXT, margin: '0 0 10px' }}>Nothing planned yet</p>
              <p style={{ fontSize: 15, color: MUTED }}>Add topics or questions for your next therapy session.</p>
            </div>
          )}

          {pending.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: 0, textTransform: 'uppercase', letterSpacing: '0.07em' }}>To Discuss ({pending.length})</p>
                <button onClick={clearAll} disabled={clearing} style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 12, cursor: clearing ? 'default' : 'pointer', opacity: clearing ? 0.5 : 1 }}>{clearing ? 'Clearing…' : 'Clear all'}</button>
              </div>
              {pending.map(topic => (
                <div key={topic.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', background: BG, border: `1px solid ${BORDER}`, borderRadius: 12, marginBottom: 8 }}>
                  <button onClick={() => toggleTopic(topic.id, topic.checked)}
                    style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, border: `2px solid ${BORDER}`, background: 'transparent', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = A}
                    onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}
                  />
                  <p style={{ fontSize: 15, color: TEXT, margin: 0, flex: 1, lineHeight: 1.5 }}>{topic.text}</p>
                  <button onClick={() => deleteTopic(topic.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, fontSize: 20, padding: '0 4px', opacity: 0.5, lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          )}

          {done.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Discussed ({done.length})</p>
              {done.map(topic => (
                <div key={topic.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, marginBottom: 8, opacity: 0.55 }}>
                  <button onClick={() => toggleTopic(topic.id, topic.checked)}
                    style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, border: 'none', background: A, color: '#fff', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>✓</button>
                  <p style={{ fontSize: 15, color: MUTED, margin: 0, flex: 1, textDecoration: 'line-through' }}>{topic.text}</p>
                  <button onClick={() => deleteTopic(topic.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, fontSize: 20, padding: '0 4px', opacity: 0.5, lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          )}

          {pending.length > 0 && (
            <div style={{ padding: '20px 24px', background: ABG, border: `1px solid ${BORDER}`, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <p style={{ fontSize: 15, fontWeight: 500, color: TEXT, margin: '0 0 3px' }}>Ready to record?</p>
                <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>These {pending.length} topic{pending.length !== 1 ? 's' : ''} will be pre-filled in your session notes.</p>
              </div>
              <Link href="/sessions"
                style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: A, color: '#fff', fontSize: 15, fontWeight: 500, textDecoration: 'none', flexShrink: 0, display: 'inline-block' }}>
                Record
              </Link>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
