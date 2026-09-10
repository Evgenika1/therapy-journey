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
import { pendingTopics, discussedTopics, groupArchivedByDate } from '@/lib/sessionTopics';

export default function NextSessionTopics() {
  const { supabase } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL: A, ERR } = useTheme();

  const [topics,   setTopics]   = useState([]);
  const [text,     setText]     = useState('');
  const [adding,   setAdding]   = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [showDone, setShowDone] = useState(false);
  const [archived,     setArchived]     = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [hoverId,      setHoverId]      = useState(null);

  useEffect(() => {
    if (!supabase) return;
    // The archive is a second query rather than a wider first one: the live list
    // is the hot path, and this only needs to answer "is there anything to
    // show, and how much". A failure here is silent — the archive link simply
    // does not appear, which must never take the block itself down.
    topicsApi.listArchived(supabase)
      .then(setArchived)
      .catch(err => console.error('[Topics] archive:', err?.message));
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

  // Back into the live list. Both flags have to go: an archived topic is
  // checked by definition, so un-archiving alone would land it in the "done"
  // fold rather than among the topics to raise.
  async function restore(id) {
    setError('');
    try {
      const back = await topicsApi.restore(supabase, id);
      setArchived(a => a.filter(x => x.id !== id));
      setTopics(t => [...t, { ...back, checked: false, archived: false }]);
    } catch (err) {
      console.error('[Topics] restore:', err?.message);
      setError('Could not restore the topic: ' + (err?.message || 'unknown error'));
    }
  }

  // The heading can only claim an archive date when every row in the day has
  // one; otherwise it says when the thought was captured. See groupArchivedByDate.
  const archiveGroups = groupArchivedByDate(archived);
  const dayLabel = (date, source) => {
    if (!date) return 'Undated';
    const when = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    return `${source === 'archived_at' ? 'Archived' : 'Added'} ${when}`;
  };

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
          for on a Tuesday morning. Recording a session archives them, so this
          fold holds what you have ticked off since — not every session's
          history. Unticking one puts it back in the list above. */}
      {done.length > 0 && (
        <>
          <button onClick={() => setShowDone(v => !v)}
            style={{ marginTop: pending.length ? 9 : 0, background: 'none', border: 'none', padding: 0, color: MUTED, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            ✓ {done.length} done <span style={{ fontSize: 9, opacity: 0.7 }}>{showDone ? '▾' : '▸'}</span>
          </button>
          {showDone && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 7 }}>
              {done.map(topic => (
                <div key={topic.id} style={{ ...row, opacity: 0.5 }}>
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
      {/* The archive: what past sessions actually raised. Collapsed by default —
          it is a record to look back on, not part of the daily job of the
          block. Nothing is shown at all until there is something in it.

          Readability is the point here, and it is why these rows do NOT reuse
          the muted grey of the "done" fold. MUTED is already tuned to sit just
          above the contrast floor (see timeTheme.js), so dimming it further
          would put archived text below it in every theme. Body colour at 0.7
          reads as recessed while staying comfortably legible on the pale
          morning background and the indigo evening one alike. */}
      {archiveGroups.length > 0 && (
        <>
          <button onClick={() => setShowArchived(v => !v)}
            style={{ marginTop: pending.length || done.length ? 10 : 0, background: 'none', border: 'none', padding: 0, color: MUTED, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
            Past topics · {archived.length} <span style={{ fontSize: 9, opacity: 0.7 }}>{showArchived ? '▾' : '▸'}</span>
          </button>

          {showArchived && (
            <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {archiveGroups.map(group => (
                <div key={group.date ?? 'undated'}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    {dayLabel(group.date, group.source)}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {group.items.map(topic => (
                      <div key={topic.id} style={row}
                        onMouseEnter={() => setHoverId(topic.id)}
                        onMouseLeave={() => setHoverId(h => (h === topic.id ? null : h))}>
                        <span aria-hidden="true"
                          style={{ width: 17, height: 17, borderRadius: 5, flexShrink: 0, background: A, color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>✓</span>
                        <p style={{ fontSize: 13, color: TEXT, opacity: 0.7, margin: 0, flex: 1, lineHeight: 1.45, textDecoration: 'line-through', minWidth: 0 }}>
                          {topic.source === 'ai' && (
                            <span title="Suggested from your session analysis" style={{ marginRight: 5, fontSize: 11 }}>✦</span>
                          )}
                          {topic.text}
                        </p>
                        {/* Kept in the DOM rather than mounted on hover, so it
                            is reachable by keyboard and on a touch screen;
                            hover only brings it forward. */}
                        <button onClick={() => restore(topic.id)}
                          aria-label={`Restore "${topic.text}" to the list`}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: A, fontSize: 11.5, padding: '0 2px', flexShrink: 0, fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: hoverId === topic.id ? 1 : 0.45 }}
                          onFocus={() => setHoverId(topic.id)}
                          onBlur={() => setHoverId(h => (h === topic.id ? null : h))}>
                          ↩ restore
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
