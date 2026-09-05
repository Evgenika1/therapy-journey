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

// Twelve categories, each an emoji, a name and a plain-language gloss. The
// glosses matter: the names are single English words, and without them it is
// not obvious in the moment where "Fear" ends and "Anxiety" begins.
//
// Keyed by name because that is what a row stores in `emotion` and what every
// lookup downstream (counts, heatmap, the Patterns analysis) reads. The six
// original categories keep their sub-emotion lists so older rows still render
// and the finer choice stays available; the six new ones have none.
const EMOTION_CATEGORIES = {
  Joy:        { emoji: '\u{1F60A}', color: '#F59E0B', about: 'joy, excitement, gratitude',        emotions: ['excited','grateful','proud','hopeful','playful'] },
  Sadness:    { emoji: '\u{1F614}', color: '#3B82F6', about: 'sadness, loss, longing',          emotions: ['lonely','disappointed','empty','hurt','melancholic'] },
  Anxiety:    { emoji: '\u{1F61F}', color: '#F97316', about: 'anxiety, worry, unease',          emotions: ['worried','nervous','overwhelmed','restless','tense'] },
  Anger:      { emoji: '\u{1F624}', color: '#EF4444', about: 'anger, irritation',            emotions: ['frustrated','irritated','resentful','furious'] },
  Fear:       { emoji: '\u{1F628}', color: '#8B5CF6', about: 'fear, vulnerability',              emotions: ['scared','insecure','threatened','panicked'] },
  Calm:       { emoji: '\u{1F30A}', color: '#10B981', about: 'calm, steadiness, peace',             emotions: ['safe','grounded','peaceful','relaxed','content'] },
  Love:       { emoji: '\u{1FAF6}', color: '#EC4899', about: 'love, closeness, warmth',        emotions: [] },
  Shame:      { emoji: '\u{1F633}', color: '#A855F7', about: 'shame, embarrassment',           emotions: [] },
  Numb:       { emoji: '\u{1F611}', color: '#64748B', about: 'numbness, emptiness',            emotions: [] },
  Excitement: { emoji: '\u{1F929}', color: '#FB923C', about: 'excitement, anticipation',      emotions: [] },
  Overwhelm:  { emoji: '\u{1F623}', color: '#DC2626', about: 'overload, "too much at once"',    emotions: [] },
  Gratitude:  { emoji: '\u{1F64F}', color: '#14B8A6', about: 'gratitude, appreciation', emotions: [] },
  Hurt:       { emoji: '\u{1F494}', color: '#BE123C', about: 'hurt, a wound, "it aches inside"',       emotions: [] },
  Loneliness: { emoji: '\u{1F311}', color: '#475569', about: 'loneliness, isolation', emotions: [] },
  Guilt:      { emoji: '\u{1F61E}', color: '#6366F1', about: 'guilt, regret, "this is my fault"',    emotions: [] },
  Hope:       { emoji: '\u{1F331}', color: '#84CC16', about: 'hope, faith, "it will get better"',    emotions: [] },
  Confusion:  { emoji: '\u{1F300}', color: '#0EA5E9', about: 'confusion, "I cannot name this"', emotions: [] },
  Relief:     { emoji: '\u{1F62E}\u{200D}\u{1F4A8}', color: '#06B6D4', about: 'relief, "it let go"', emotions: [] },
};

const EMOTION_ORDER = Object.keys(EMOTION_CATEGORIES);

function Heatmap({ logs }) {
  const { MUTED, BORDER } = useTheme();
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
    if (!day || !data[day]) return BORDER; // themed: the old '#E8F0EC' vanished in dark mode
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
        <span style={{ fontSize: 17, lineHeight: 1, flexShrink: 0 }}>{info?.emoji ?? '\u2022'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 500, color: TEXT, margin: '0 0 3px' }}>{log.emotion_name}</p>
          <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>{log.category} · {new Date(log.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
          {log.note && <p style={{ fontSize: 12.5, color: MUTED, margin: '5px 0 0', lineHeight: 1.5, fontStyle: 'italic' }}>«{log.note}»</p>}
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
        {log.note && <p style={{ fontSize: 12.5, color: MUTED, margin: '5px 0 0', lineHeight: 1.5, fontStyle: 'italic' }}>«{log.note}»</p>}
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
  const [selectedCats, setSelectedCats] = useState([]);   // multi-select across the grid
  const [selectedEmos, setSelectedEmos] = useState([]);
  const [intensity,   setIntensity]   = useState(5);
  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewCat, setViewCat] = useState(null);
  const [note,    setNote]    = useState('');
  // saveLog() had no catch: on a rejected insert the modal simply stayed open
  // with the selection intact and no explanation.
  const [error,   setError]   = useState('');

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

  // Deselecting a category also drops any sub-emotions that belonged only to it,
  // so a hidden chip cannot ride along into the saved row.
  function toggleCat(cat) {
    setSelectedCats(prev => {
      const next = prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat];
      const stillOffered = new Set(next.flatMap(c => EMOTION_CATEGORIES[c]?.emotions || []));
      setSelectedEmos(es => es.filter(e => stillOffered.has(e)));
      return next;
    });
  }

  async function saveLog() {
    if (selectedCats.length === 0) return;
    setSaving(true); setError('');
    try {
      // One row per selected category. The table has always held one category
      // per row — counts, the heatmap and the Patterns analysis all read
      // `emotion` that way — so multi-select fans out rather than inventing a
      // second shape for the same data.
      const entries = [];
      for (const cat of selectedCats) {
        const subs = selectedEmos.filter(e => (EMOTION_CATEGORIES[cat]?.emotions || []).includes(e));
        entries.push(await emotionsApi.save(supabase, { category: cat, sub_emotions: subs, intensity, note }));
      }
      const entry = entries[0];
      setLogs(l => [...entries, ...l]);
      // The note column arrives with migration 017. Until it is applied the
      // emotion is still saved but the note is not — say so rather than show
      // the text once and lose it on the next load.
      if (note.trim() && entry.dropped_columns?.includes('note')) {
        setError('Emotion saved, but the note was not: the database has no note column yet (migration 017).');
        return;
      }
      setLogging(false); setSelectedCats([]); setSelectedEmos([]); setIntensity(5); setNote('');
    } catch (err) {
      console.error('[Emotions] save:', err?.message);
      setError('Could not save: ' + (err?.message || 'unknown error'));
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
              <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 300, color: TEXT, margin: '0 0 4px', lineHeight: 1.2 }}>Emotions</h1>
              <p style={{ fontSize: 15, color: MUTED, margin: 0 }}>Track and understand your emotional patterns</p>
            </div>
            <button onClick={() => { setLogging(true); setSelectedCats([]); setSelectedEmos([]); setIntensity(5); setNote(''); setError(''); }}
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
                <p style={{ fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 300, color: A, margin: 0 }}>{s.value}</p>
              </div>
            ))}
          </div>

          <div style={{ background: SURFACE, borderRadius: 12, padding: '24px 28px', marginBottom: 24, border: `1px solid ${BORDER}` }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>90-Day Activity</p>
            <Heatmap logs={logs} />
          </div>

          <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Categories</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: 12, marginBottom: 28 }}>
            {EMOTION_ORDER.map(cat => EMOTION_CATEGORIES[cat] && ((info) => (
              <button key={cat} onClick={() => setViewCat(viewCat === cat ? null : cat)}
                style={{ padding: '18px 20px', borderRadius: 12, border: `1px solid ${viewCat === cat ? info.color : BORDER}`, background: viewCat === cat ? info.color + '12' : BG, textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 6 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    <span style={{ fontSize: 17, lineHeight: 1 }}>{info.emoji}</span>
                    <span style={{ fontSize: 14, fontWeight: 500, color: TEXT }}>{cat}</span>
                  </span>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: info.color, flexShrink: 0 }} />
                </div>
                <p style={{ fontSize: 11.5, color: MUTED, margin: '0 0 10px', lineHeight: 1.45 }}>{info.about}</p>
                <p style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 300, color: info.color, margin: 0, lineHeight: 1 }}>{catCounts[cat] ?? 0}</p>
                <p style={{ fontSize: 12, color: MUTED, margin: '2px 0 0' }}>logs</p>
              </button>
            ))(EMOTION_CATEGORIES[cat]))}
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
          <div style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 32, width: '100%', maxWidth: 560, maxHeight: 'calc(100vh - 40px)', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 300, color: TEXT, margin: '0 0 24px' }}>Log Emotion</h2>

            <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              What are you feeling? <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>— pick as many as fit</span>
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(126px, 1fr))', gap: 8, marginBottom: 22 }}>
              {EMOTION_ORDER.map(cat => {
                const info = EMOTION_CATEGORIES[cat];
                const on = selectedCats.includes(cat);
                return (
                  <button key={cat} onClick={() => toggleCat(cat)}
                    style={{ padding: '11px 10px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                             border: `1.5px solid ${on ? A : BORDER}`, background: on ? A + '14' : 'transparent',
                             display: 'flex', flexDirection: 'column', gap: 3, transition: 'border-color 0.12s, background 0.12s' }}>
                    <span style={{ fontSize: 19, lineHeight: 1 }}>{info.emoji}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: on ? A : TEXT }}>{cat}</span>
                    <span style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.35 }}>{info.about}</span>
                  </button>
                );
              })}
            </div>

            {selectedCats.some(c => (EMOTION_CATEGORIES[c]?.emotions || []).length > 0) && (
              <>
                <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  Narrow it down <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>— optional</span>
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
                  {selectedCats.flatMap(cat => (EMOTION_CATEGORIES[cat]?.emotions || []).map(emo => {
                    const on = selectedEmos.includes(emo);
                    const color = EMOTION_CATEGORIES[cat].color;
                    return (
                      <button key={cat + emo} onClick={() => toggleEmo(emo)}
                        style={{ padding: '7px 14px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${on ? color : BORDER}`, background: on ? color + '12' : 'transparent', fontSize: 13.5, color: on ? color : MUTED, fontWeight: on ? 600 : 400, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12 }}>{on ? '\u2713' : '+'}</span>{emo}
                      </button>
                    );
                  }))}
                </div>
              </>
            )}

            <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Intensity — {intensity}/10</p>
                <input type="range" min={1} max={10} value={intensity} onChange={e => setIntensity(Number(e.target.value))}
                  style={{ width: '100%', marginBottom: 22, accentColor: A, cursor: 'pointer' }} />

                {/* Optional context. The category and sub-emotions record what
                    was felt; this is the only place that says what it was about. */}
                <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  Note <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>— optional</span>
                </p>
                <textarea value={note} onChange={e => setNote(e.target.value)}
                  placeholder="What happened? For example: &quot;argued with my mum&quot;, &quot;a good session&quot;"
                  style={{ width: '100%', boxSizing: 'border-box', minHeight: 68, padding: '10px 13px', borderRadius: 10, border: `1px solid ${BORDER}`, background: SURFACE, color: TEXT, fontSize: 13.5, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.6, marginBottom: 22 }} />

            {/* Left unexplained, a disabled primary button reads as a dead one:
                greyed out, still showing a pointer cursor, doing nothing. */}
            {selectedCats.length === 0 && (
              <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 14px' }}>
                Pick at least one emotion to save.
              </p>
            )}

            {error && <p style={{ fontSize: 13, color: '#DC2626', margin: '0 0 14px', lineHeight: 1.5 }}>⚠ {error}</p>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setLogging(false)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 15, cursor: 'pointer' }}>Cancel</button>
              <button onClick={saveLog} disabled={selectedCats.length === 0 || saving}
                style={{ flex: 2, padding: '10px', borderRadius: 10, border: 'none', background: A, color: '#fff', fontSize: 15, fontWeight: 500,
                         cursor: (selectedCats.length === 0 || saving) ? 'not-allowed' : 'pointer',
                         opacity: selectedCats.length === 0 ? 0.5 : 1 }}>
                {saving ? 'Saving…' : selectedCats.length > 1 ? `Log ${selectedCats.length} Emotions` : 'Log Emotion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
