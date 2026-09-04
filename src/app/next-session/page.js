'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { topics as topicsApi } from '@/lib/api';
import { useTheme } from '@/lib/ThemeContext';
import { countdownFrom, SESSION_DATE_KEY } from '@/lib/nextSession';

function Countdown({ targetDate }) {
  const { CORAL: A, MUTED, ERR } = useTheme();
  // Re-derived on a timer so the panel flips to "passed" on its own if the page
  // is left open across the appointment, rather than counting down past zero.
  const [state, setState] = useState(() => countdownFrom(targetDate));

  useEffect(() => {
    const update = () => setState(countdownFrom(targetDate));
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [targetDate]);

  if (state.status === 'none') {
    return <p style={{ fontSize: 15, color: MUTED, margin: 0 }}>Set your next session date to see the countdown</p>;
  }

  // The reported bug: this used to fall through to the digits and render
  // 00:00:00, which reads as a broken clock rather than a date that has been
  // sitting there since June. Say what is actually true, and what to do.
  if (state.status === 'past') {
    return (
      <div>
        <p style={{ fontFamily: 'var(--font-serif)', fontSize: 34, fontWeight: 300, color: MUTED, margin: 0, lineHeight: 1 }}>—</p>
        <p style={{ fontSize: 13, color: ERR, margin: '8px 0 0', fontWeight: 500 }}>
          This date has passed, update it
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
      {[
        [state.days,  'days'],
        [state.hours, 'hours'],
        [state.mins,  'mins'],
      ].map(([val, label]) => (
        <div key={label} style={{ textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: 40, fontWeight: 300, color: A, margin: 0, lineHeight: 1, minWidth: 56 }}>{String(val).padStart(2, '0')}</p>
          <p style={{ fontSize: 11, color: MUTED, margin: '4px 0 0', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</p>
        </div>
      ))}
    </div>
  );
}

export default function NextSessionPage() {
  const { supabase } = useAuth();
  const { BG, BORDER, MUTED, SURFACE, CORAL: A, NAV_ACTIVE: ABG, H1: TEXT, ERR } = useTheme();
  const [topics,      setTopics]      = useState([]);
  const [newText,     setNewText]     = useState('');
  const [adding,      setAdding]      = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [clearing,    setClearing]    = useState(false);
  const [sessionDate, setSessionDate] = useState('');
  // addTopic/toggleTopic/deleteTopic had no catch — a rejected write cleared the
  // input or moved the item as though it had been saved.
  const [error,       setError]       = useState('');

  useEffect(() => {
    if (!supabase) return;
    topicsApi.list(supabase)
      .then(l => { setTopics(l); setLoading(false); })
      .catch(err => {
        // The list previously never left its loading state on failure.
        console.error('[NextSession] list:', err?.message);
        setError('Не удалось загрузить темы: ' + (err?.message || 'неизвестная ошибка'));
        setLoading(false);
      });
  }, [supabase]);

  // Its own effect: this used to sit after an `if (!supabase) return`, so the
  // saved date was only read once auth had come up — and never at all for a
  // signed-out visitor, though the value is purely local.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_DATE_KEY);
      if (saved) setSessionDate(saved);
    } catch (e) {
      // Private mode and blocked site data both throw on access.
      console.error('[NextSession] read date:', e?.message);
    }
  }, []);

  function handleDateChange(e) {
    const value = e.target.value;
    setSessionDate(value);
    try {
      // Clearing the field clears the stored value too, otherwise the old date
      // comes back on the next visit.
      if (value) localStorage.setItem(SESSION_DATE_KEY, value);
      else localStorage.removeItem(SESSION_DATE_KEY);
    } catch (e) {
      console.error('[NextSession] save date:', e?.message);
    }
  }

  async function addTopic() {
    if (!newText.trim()) return;
    setAdding(true); setError('');
    try {
      const topic = await topicsApi.save(supabase, newText.trim());
      setTopics(t => [...t, topic]);
      setNewText('');
    } catch (err) {
      // Leave the text in the input so a failed add doesn't lose it.
      console.error('[NextSession] add:', err?.message);
      setError('Не удалось добавить тему: ' + (err?.message || 'неизвестная ошибка'));
    } finally { setAdding(false); }
  }

  async function toggleTopic(id, checked) {
    setError('');
    try {
      await topicsApi.update(supabase, id, { checked: !checked });
      setTopics(t => t.map(x => x.id === id ? { ...x, checked: !checked } : x));
    } catch (err) {
      console.error('[NextSession] toggle:', err?.message);
      setError('Не удалось обновить тему: ' + (err?.message || 'неизвестная ошибка'));
    }
  }

  async function deleteTopic(id) {
    setError('');
    try {
      await topicsApi.delete(supabase, id);
      setTopics(t => t.filter(x => x.id !== id));
    } catch (err) {
      console.error('[NextSession] delete:', err?.message);
      setError('Не удалось удалить тему: ' + (err?.message || 'неизвестная ошибка'));
    }
  }

  async function clearAll() {
    if (!confirm('Clear all topics?')) return;
    setClearing(true); setError('');
    try {
      await Promise.all(topics.map(t => topicsApi.delete(supabase, t.id)));
      setTopics([]);
    } catch (err) {
      // Some deletes may have succeeded — refetch rather than guess.
      console.error('[NextSession] clear all:', err?.message);
      setError('Не удалось удалить все темы: ' + (err?.message || 'неизвестная ошибка'));
      topicsApi.list(supabase).then(setTopics).catch(() => {});
    } finally { setClearing(false); }
  }

  const dateStatus = countdownFrom(sessionDate).status;
  const datePassed = dateStatus === 'past';

  const pending = topics.filter(t => !t.checked);
  const done    = topics.filter(t => t.checked);

  return (
    <AppLayout>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: BG, fontFamily: '"Plus Jakarta Sans", sans-serif', color: TEXT, paddingBottom: 60 }}>
        <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>

          <div style={{ marginBottom: 32 }}>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 300, color: TEXT, margin: '0 0 4px', lineHeight: 1.2 }}>Next Session</h1>
            <p style={{ fontSize: 15, color: MUTED, margin: 0 }}>Prepare topics and questions for your therapist</p>
          </div>

          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20 }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Countdown</p>
                <Countdown targetDate={sessionDate} />
              </div>
              <div>
                <p style={{ fontSize: 12, color: MUTED, margin: '0 0 6px', fontWeight: 500 }}>Next session date</p>
                <input type="datetime-local" value={sessionDate} onChange={handleDateChange}
                  aria-label="Next session date"
                  style={{ padding: '9px 14px', borderRadius: 10, border: `1px solid ${datePassed ? ERR : BORDER}`, fontSize: 14, color: TEXT, background: BG, outline: 'none', cursor: 'pointer' }}
                />
                {/* type="datetime-local" has no placeholder of its own, so the
                    prompt lives under the field where a hint would go anyway. */}
                {/* Only the prompt lives here. The "has passed" warning is
                    stated once, next to the countdown it replaced; saying it
                    twice in one panel is noise, and the red border already
                    points at the field to change. */}
                <p style={{ fontSize: 11.5, color: MUTED, margin: '6px 0 0', minHeight: 15 }}>
                  {dateStatus === 'none' ? 'Set your next session date' : ''}
                </p>
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

          {error && <p style={{ fontSize: 13, color: '#DC2626', margin: '0 0 16px', lineHeight: 1.5 }}>⚠ {error}</p>}

          {loading && <p style={{ fontSize: 15, color: MUTED }}>Loading…</p>}

          {!loading && topics.length === 0 && (
            <div style={{ textAlign: 'center', padding: '80px 0' }}>
              <p style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 300, color: TEXT, margin: '0 0 10px' }}>Nothing planned yet</p>
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
