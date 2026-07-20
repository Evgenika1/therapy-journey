'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { emotions as emotionsApi } from '@/lib/api';
import { useTheme } from '@/lib/ThemeContext';

const SIMPLE_MOODS = [
  { emoji: '😞', intensity: 2 },
  { emoji: '😟', intensity: 4 },
  { emoji: '😐', intensity: 6 },
  { emoji: '🙂', intensity: 8 },
  { emoji: '😊', intensity: 10 },
];
function closestMoodIdx(intensity) {
  const v = intensity ?? 6;
  return SIMPLE_MOODS.reduce((bi, m, i) =>
    Math.abs(m.intensity - v) < Math.abs(SIMPLE_MOODS[bi].intensity - v) ? i : bi, 0);
}

const EMOTION_CATEGORIES = {
  Joy:     { emotions: ['excited','grateful','proud','hopeful','playful'],      color: '#F59E0B' },
  Sadness: { emotions: ['lonely','disappointed','empty','hurt','melancholic'],  color: '#3B82F6' },
  Anxiety: { emotions: ['worried','nervous','overwhelmed','restless','tense'],  color: '#F97316' },
  Anger:   { emotions: ['frustrated','irritated','resentful','furious'],        color: '#EF4444' },
  Fear:    { emotions: ['scared','insecure','threatened','panicked'],           color: '#8B5CF6' },
  Calm:    { emotions: ['safe','grounded','peaceful','relaxed','content'],      color: '#10B981' },
};

function Heatmap({ logs }) {
  const { MUTED } = useTheme();
  const data = useMemo(() => {
    const map = {};
    for (const l of logs) {
      const day = l.created_at?.slice(0, 10);
      if (!day) continue;
      if (!map[day]) map[day] = { count: 0, total: 0 };
      map[day].count++;
      map[day].total += l.intensity || 5;
    }
    Object.values(map).forEach(v => { v.avg = v.total / v.count; });
    return map;
  }, [logs]);

  const days = [];
  const today = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const firstDay = new Date(days[0]).getDay();
  const padded = [...Array(firstDay).fill(null), ...days];

  function cellColor(day) {
    if (!day || !data[day]) return '#E8F0EC';
    const alpha = 0.2 + (data[day].avg / 10) * 0.8;
    return `rgba(45,106,79,${alpha})`;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 2, overflowX: 'auto' }}>
        {Array.from({ length: Math.ceil(padded.length / 7) }, (_, col) => (
          <div key={col} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {padded.slice(col * 7, col * 7 + 7).map((day, row) => (
              <div key={row} title={day ? `${day}: ${data[day]?.count ?? 0} logs` : ''}
                style={{ width: 12, height: 12, borderRadius: 3, background: cellColor(day) }} />
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <span style={{ fontSize: 11, color: MUTED }}>Less</span>
        {[0.1,0.3,0.5,0.7,0.95].map(a => (
          <div key={a} style={{ width: 12, height: 12, borderRadius: 3, background: `rgba(45,106,79,${a})` }} />
        ))}
        <span style={{ fontSize: 11, color: MUTED }}>More intense</span>
      </div>
    </div>
  );
}

function LogEntry({ log, catColor, variant, onUpdate, onDelete, BORDER, MUTED, TEXT, BG, A }) {
  const [hovered,    setHovered]    = useState(false);
  const [editing,    setEditing]    = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const info = EMOTION_CATEGORIES[log.category];
  const color = catColor ?? info?.color ?? A;

  const actions = editing ? (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
      {SIMPLE_MOODS.map((m, i) => (
        <button key={i} onClick={() => { onUpdate(log.id, i); setEditing(false); }} title={m.emoji}
          style={{ width: 36, height: 36, borderRadius: 8, border: `2px solid ${closestMoodIdx(log.intensity) === i ? A : BORDER}`, background: closestMoodIdx(log.intensity) === i ? A + '18' : 'transparent', fontSize: 20, cursor: 'pointer' }}>
          {m.emoji}
        </button>
      ))}
      <button onClick={() => setEditing(false)} style={{ marginLeft: 2, fontSize: 16, color: MUTED, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}>✕</button>
    </div>
  ) : confirmDel ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 13, color: MUTED }}>Delete?</span>
      <button onClick={() => { onDelete(log.id); setConfirmDel(false); }} style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#EF4444', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Yes</button>
      <button onClick={() => setConfirmDel(false)} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 12, cursor: 'pointer' }}>No</button>
    </div>
  ) : hovered ? (
    <div style={{ display: 'flex', gap: 4 }}>
      <button onClick={() => setEditing(true)} title="Edit"
        style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${BORDER}`, background: 'transparent', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✏️</button>
      <button onClick={() => setConfirmDel(true)} title="Delete"
        style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🗑️</button>
    </div>
  ) : null;

  if (variant === 'today') {
    return (
      <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => { setHovered(false); setConfirmDel(false); }}
        style={{ background: BG, border: `1px solid ${hovered ? A + '60' : BORDER}`, borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, transition: 'border-color 0.12s' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 500, color: TEXT, margin: '0 0 3px' }}>{log.emotion_name}</p>
          <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>{log.category} · {new Date(log.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
        {!editing && !confirmDel && (
          <span style={{ fontSize: 15, fontWeight: 600, color }}>{log.intensity}/10</span>
        )}
        {actions}
      </div>
    );
  }

  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => { setHovered(false); setConfirmDel(false); }}
      style={{ padding: '14px 20px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 14, transition: 'background 0.1s', background: hovered ? BORDER + '30' : 'transparent' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 500, color: TEXT, margin: '0 0 3px' }}>{log.emotion_name}</p>
        <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>{new Date(log.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
      </div>
      {!editing && !confirmDel && (
        <>
          <div style={{ display: 'flex', gap: 2 }}>
            {[...Array(10)].map((_, i) => (
              <div key={i} style={{ width: 5, height: 16, borderRadius: 2, background: i < (log.intensity || 5) ? color : BORDER }} />
            ))}
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color, minWidth: 36, textAlign: 'right' }}>{log.intensity}/10</span>
        </>
      )}
      {actions}
    </div>
  );
}

export default function EmotionsPage() {
  const { supabase } = useAuth();
  const { BG, BORDER, MUTED, SURFACE, CORAL: A, NAV_ACTIVE: ABG, H1: TEXT } = useTheme();
  const [logs,        setLogs]        = useState([]);
  const [logging,     setLogging]     = useState(false);
  const [selectedCat,  setSelectedCat]  = useState(null);
  const [selectedEmos, setSelectedEmos] = useState([]);
  const [intensity,   setIntensity]   = useState(5);
  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewCat, setViewCat] = useState(null);

  useEffect(() => {
    if (!supabase) return;
    emotionsApi.list(supabase).then(l => { setLogs(l); setLoading(false); }).catch(err => console.error('[Emotions]', err?.message));
  }, [supabase]);

  const handleUpdate = useCallback(async (id, moodIdx) => {
    const m = SIMPLE_MOODS[moodIdx];
    try {
      await emotionsApi.update(supabase, id, { intensity: m.intensity });
      setLogs(l => l.map(e => e.id === id ? { ...e, intensity: m.intensity } : e));
    } catch (err) { console.error('[Emotions] update:', err?.message); }
  }, [supabase]);

  const handleDelete = useCallback(async (id) => {
    try {
      await emotionsApi.delete(supabase, id);
      setLogs(l => l.filter(e => e.id !== id));
    } catch (err) { console.error('[Emotions] delete:', err?.message); }
  }, [supabase]);

  function toggleEmo(emo) {
    setSelectedEmos(prev => prev.includes(emo) ? prev.filter(e => e !== emo) : [...prev, emo]);
  }

  async function saveLog() {
    if (!selectedCat || selectedEmos.length === 0) return;
    setSaving(true);
    try {
      const entry = await emotionsApi.save(supabase, { category: selectedCat, sub_emotions: selectedEmos, intensity });
      setLogs(l => [entry, ...l]);
      setLogging(false); setSelectedCat(null); setSelectedEmos([]); setIntensity(5);
    } finally { setSaving(false); }
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayLogs = logs.filter(l => l.created_at?.slice(0, 10) === today);
  const avgIntensity = logs.length ? (logs.reduce((a, l) => a + (l.intensity || 5), 0) / logs.length).toFixed(1) : '—';
  const catCounts = useMemo(() => {
    const m = {};
    for (const l of logs) { if (l.category) m[l.category] = (m[l.category] || 0) + 1; }
    return m;
  }, [logs]);
  const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'None yet';

  return (
    <AppLayout>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: BG, fontFamily: '"Plus Jakarta Sans", sans-serif', color: TEXT, paddingBottom: 60 }}>
        <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>

          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 32 }}>
            <div>
              <h1 style={{ fontFamily: '"Fraunces", serif', fontSize: 32, fontWeight: 300, color: TEXT, margin: '0 0 4px', lineHeight: 1.2 }}>Emotions</h1>
              <p style={{ fontSize: 15, color: MUTED, margin: 0 }}>Track and understand your emotional patterns</p>
            </div>
            <button onClick={() => { setLogging(true); setSelectedCat(null); setSelectedEmos([]); setIntensity(5); }}
              style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: A, color: '#fff', fontSize: 15, fontWeight: 500, cursor: 'pointer', flexShrink: 0 }}>
              + Log Emotion
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 28 }}>
            {[
              { label: 'Total Logs',    value: loading ? '—' : logs.length },
              { label: 'Avg Intensity', value: loading ? '—' : avgIntensity + '/10' },
              { label: 'Top Category',  value: loading ? '—' : topCat },
            ].map(s => (
              <div key={s.label} style={{ background: BG, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${A}`, borderRadius: 12, padding: 20 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{s.label}</p>
                <p style={{ fontFamily: '"Fraunces", serif', fontSize: 32, fontWeight: 300, color: A, margin: 0 }}>{s.value}</p>
              </div>
            ))}
          </div>

          <div style={{ background: SURFACE, borderRadius: 12, padding: '24px 28px', marginBottom: 24, border: `1px solid ${BORDER}` }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>90-Day Activity</p>
            <Heatmap logs={logs} />
          </div>

          <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Categories</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 28 }}>
            {Object.entries(EMOTION_CATEGORIES).map(([cat, info]) => (
              <button key={cat} onClick={() => setViewCat(viewCat === cat ? null : cat)}
                style={{ padding: '18px 20px', borderRadius: 12, border: `1px solid ${viewCat === cat ? info.color : BORDER}`, background: viewCat === cat ? info.color + '12' : BG, textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: TEXT }}>{cat}</span>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: info.color }} />
                </div>
                <p style={{ fontFamily: '"Fraunces", serif', fontSize: 28, fontWeight: 300, color: info.color, margin: 0, lineHeight: 1 }}>{catCounts[cat] ?? 0}</p>
                <p style={{ fontSize: 12, color: MUTED, margin: '2px 0 0' }}>logs</p>
              </button>
            ))}
          </div>

          {viewCat && (
            <div style={{ background: BG, borderRadius: 12, overflow: 'hidden', marginBottom: 24, border: `1px solid ${BORDER}` }}>
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: EMOTION_CATEGORIES[viewCat].color }} />
                <span style={{ fontSize: 15, fontWeight: 500, color: TEXT }}>{viewCat}</span>
              </div>
              {logs.filter(l => l.category === viewCat).slice(0, 10).map(l => (
                <LogEntry key={l.id} log={l} catColor={EMOTION_CATEGORIES[viewCat].color} variant="cat"
                  onUpdate={handleUpdate} onDelete={handleDelete}
                  BORDER={BORDER} MUTED={MUTED} TEXT={TEXT} BG={BG} A={A} />
              ))}
            </div>
          )}

          {todayLogs.length > 0 && (
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Today</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {todayLogs.map(l => (
                  <LogEntry key={l.id} log={l} variant="today"
                    onUpdate={handleUpdate} onDelete={handleDelete}
                    BORDER={BORDER} MUTED={MUTED} TEXT={TEXT} BG={BG} A={A} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {logging && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 32, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <h2 style={{ fontFamily: '"Fraunces", serif', fontSize: 26, fontWeight: 300, color: TEXT, margin: '0 0 24px' }}>Log Emotion</h2>

            <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Category</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 22 }}>
              {Object.entries(EMOTION_CATEGORIES).map(([cat, info]) => (
                <button key={cat} onClick={() => { setSelectedCat(cat); setSelectedEmos([]); }}
                  style={{ padding: '12px 8px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${selectedCat === cat ? info.color : BORDER}`, background: selectedCat === cat ? info.color + '12' : 'transparent', display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.12s' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: info.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 500, color: TEXT }}>{cat}</span>
                </button>
              ))}
            </div>

            {selectedCat && (
              <>
                <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Emotions — select all that apply</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
                  {EMOTION_CATEGORIES[selectedCat].emotions.map(emo => {
                    const on = selectedEmos.includes(emo);
                    const color = EMOTION_CATEGORIES[selectedCat].color;
                    return (
                      <button key={emo} onClick={() => toggleEmo(emo)}
                        style={{ padding: '7px 14px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${on ? color : BORDER}`, background: on ? color + '12' : 'transparent', fontSize: 14, color: on ? color : MUTED, fontWeight: on ? 600 : 400, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13 }}>{on ? '✓' : '+'}</span>
                        {emo}
                      </button>
                    );
                  })}
                </div>

                <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Intensity — {intensity}/10</p>
                <input type="range" min={1} max={10} value={intensity} onChange={e => setIntensity(Number(e.target.value))}
                  style={{ width: '100%', marginBottom: 24, accentColor: A, cursor: 'pointer' }} />
              </>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setLogging(false)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 15, cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveLog} disabled={!selectedCat || selectedEmos.length === 0 || saving}
                style={{ flex: 2, padding: '10px', borderRadius: 10, border: 'none', background: A, color: '#fff', fontSize: 15, fontWeight: 500, cursor: 'pointer', opacity: (!selectedCat || selectedEmos.length === 0) ? 0.5 : 1 }}>
                {saving ? 'Saving…' : selectedEmos.length > 1 ? `Log ${selectedEmos.length} Emotions` : 'Log Emotion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
