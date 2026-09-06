'use client';
//
// "Things to raise with your therapist", on the dashboard rather than behind a
// menu item. The point of the block is capture: a thought worth raising turns
// up on a Tuesday, and the cost of writing it down has to be near zero or it is
// gone by Friday. That is why it sits on the first screen and why the input is
// the first thing in it.
//
// It replaces the Next Session page, minus the countdown — a date and a clock
// were never what made this useful.

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { topics as topicsApi } from '@/lib/api';
import { pendingTopics, discussedTopics } from '@/lib/sessionTopics';

export default function NextSessionTopics() {
  const { supabase } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL: A, ERR } = useTheme();

  const [topics,   setTopics]   = useState([]);
  const [text,     setText]     = useState('');
  const [adding,   setAdding]   = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    topicsApi.list(supabase)
      .then(l => { setTopics(l); setLoading(false); })
      .catch(err => {
        console.error('[Topics] list:', err?.message);
        setError('Could not load your topics: ' + (err?.message || 'unknown error'));
        setLoading(false);
      });
  }, [supabase]);

  async function add() {
    const value = text.trim();
    if (!value || adding) return;
    setAdding(true); setError('');
    try {
      const topic = await topicsApi.save(supabase, value);
      setTopics(t => [...t, topic]);
      setText('');
    } catch (err) {
      // The text stays in the input: a failed write must not also lose the
      // thought the user just had.
      console.error('[Topics] add:', err?.message);
      setError('Could not add the topic: ' + (err?.message || 'unknown error'));
    } finally { setAdding(false); }
  }

  async function toggle(id, checked) {
    setError('');
    try {
      await topicsApi.update(supabase, id, { checked: !checked });
      setTopics(t => t.map(x => x.id === id ? { ...x, checked: !checked } : x));
    } catch (err) {
      console.error('[Topics] toggle:', err?.message);
      setError('Could not update the topic: ' + (err?.message || 'unknown error'));
    }
  }

  async function remove(id) {
    setError('');
    try {
      await topicsApi.delete(supabase, id);
      setTopics(t => t.filter(x => x.id !== id));
    } catch (err) {
      console.error('[Topics] delete:', err?.message);
      setError('Could not delete the topic: ' + (err?.message || 'unknown error'));
    }
  }

  const pending = pendingTopics(topics);
  const done    = discussedTopics(topics);

  // Split by where a topic came from. A caption under every AI row would say
  // the same sentence a dozen times; one heading above the group says it once
  // and stays one line however long the list gets.
  const mine     = pending.filter(t => t.source !== 'ai');
  const suggested = pending.filter(t => t.source === 'ai');

  const row = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '7px 10px', background: BG,
    border: `1px solid ${BORDER}`, borderRadius: 9,
  };

  // Both groups render the same row. The ✦ is gone from inside it — the heading
  // above the group carries that now, and repeating it per line was the noise
  // this change is removing.
  const TopicRow = ({ topic }) => (
    <div style={row}>
      <button onClick={() => toggle(topic.id, topic.checked)}
        aria-label={`Mark "${topic.text}" as discussed`}
        style={{ width: 17, height: 17, borderRadius: 5, flexShrink: 0, border: `2px solid ${BORDER}`, background: 'transparent', cursor: 'pointer', padding: 0 }}
        onMouseEnter={e => e.currentTarget.style.borderColor = A}
        onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}
      />
      <p style={{ fontSize: 13, color: TEXT, margin: 0, flex: 1, lineHeight: 1.45, minWidth: 0 }}>{topic.text}</p>
      <button onClick={() => remove(topic.id)} aria-label={`Delete "${topic.text}"`}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, fontSize: 16, padding: '0 2px', opacity: 0.5, lineHeight: 1, flexShrink: 0 }}>×</button>
    </div>
  );

  return (
    <section style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '13px 15px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 9 }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 400, color: TEXT, margin: 0 }}>
          For your next session
        </h2>
        {pending.length > 0 && (
          <span style={{ fontSize: 11, color: MUTED }}>
            {pending.length} to raise
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 7, marginBottom: pending.length || done.length ? 10 : 0 }}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Something on your mind? Add it here…"
          style={{
            flex: 1, minWidth: 0, padding: '8px 12px', borderRadius: 9,
            border: `1px solid ${BORDER}`, fontSize: 13, color: TEXT,
            background: BG, outline: 'none', fontFamily: 'inherit',
          }}
          onFocus={e => e.target.style.borderColor = A}
          onBlur={e  => e.target.style.borderColor = BORDER}
        />
        <button onClick={add} disabled={!text.trim() || adding}
          style={{
            padding: '8px 16px', borderRadius: 9, border: 'none',
            background: A, color: '#fff', fontSize: 13, fontWeight: 500,
            cursor: text.trim() ? 'pointer' : 'default',
            opacity: text.trim() ? 1 : 0.45, flexShrink: 0, fontFamily: 'inherit',
          }}>
          {adding ? '…' : 'Add'}
        </button>
      </div>

      {error && <p style={{ fontSize: 12, color: ERR, margin: '0 0 8px', lineHeight: 1.5 }}>⚠ {error}</p>}

      {loading && <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>Loading…</p>}

      {!loading && pending.length === 0 && done.length === 0 && (
        <p style={{ fontSize: 12, color: MUTED, margin: '8px 0 0', lineHeight: 1.5 }}>
          Anything you want to raise with your therapist — catch it here while it is fresh,
          and it will be waiting in your notes when you record.
        </p>
      )}

      {/* Yours first. It only needs naming when there is a second group under
          it to be told apart from. */}
      {mine.length > 0 && (
        <>
          {suggested.length > 0 && (
            <p style={{ fontSize: 10.5, fontWeight: 600, color: MUTED, margin: '2px 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Added by you
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {mine.map(topic => <TopicRow key={topic.id} topic={topic} />)}
          </div>
        </>
      )}

      {suggested.length > 0 && (
        <>
          <p style={{ fontSize: 10.5, fontWeight: 600, color: A, margin: `${mine.length ? 12 : 2}px 0 6px`, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            ✦ Suggested from your sessions
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {suggested.map(topic => <TopicRow key={topic.id} topic={topic} />)}
          </div>
        </>
      )}

      {/* Discussed topics are kept but folded away. They are the record of what
          you did raise, which is worth keeping; they are not what this block is
          for on a Tuesday morning. */}
      {done.length > 0 && (
        <>
          <button onClick={() => setShowDone(v => !v)}
            style={{ marginTop: pending.length ? 9 : 0, background: 'none', border: 'none', padding: 0, color: MUTED, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            {showDone ? 'Hide' : 'Show'} {done.length} discussed
          </button>
          {showDone && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 7 }}>
              {done.map(topic => (
                <div key={topic.id} style={{ ...row, opacity: 0.55 }}>
                  <button onClick={() => toggle(topic.id, topic.checked)}
                    aria-label={`Move "${topic.text}" back to the list`}
                    style={{ width: 17, height: 17, borderRadius: 5, flexShrink: 0, border: 'none', background: A, color: '#fff', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, padding: 0 }}>✓</button>
                  {/* Discussed topics are one mixed list, so the mark earns its
                      place here — there is no heading to carry it. */}
                  <p style={{ fontSize: 13, color: MUTED, margin: 0, flex: 1, textDecoration: 'line-through', minWidth: 0 }}>
                    {topic.source === 'ai' && (
                      <span title="Suggested from your session analysis"
                        style={{ marginRight: 5, fontSize: 11 }}>✦</span>
                    )}
                    {topic.text}
                  </p>
                  <button onClick={() => remove(topic.id)} aria-label={`Delete "${topic.text}"`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, fontSize: 16, padding: '0 2px', opacity: 0.5, lineHeight: 1, flexShrink: 0 }}>×</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
