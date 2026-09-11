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
import { pendingTopics, groupArchivedByDate } from '@/lib/sessionTopics';

export default function NextSessionTopics() {
  const { supabase } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL: A, ERR } = useTheme();

  const [topics,   setTopics]   = useState([]);
  const [text,     setText]     = useState('');
  const [adding,   setAdding]   = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [archived,     setArchived]     = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [hoverId,      setHoverId]      = useState(null);
  const [moreArchived, setMoreArchived] = useState(false);
  const [loadingAll,   setLoadingAll]   = useState(false);
  // null means "the default": newest day open, everything older folded. It
  // becomes a Set the moment the user disagrees with that.
  const [openDays,     setOpenDays]     = useState(null);

  useEffect(() => {
    if (!supabase) return;
    // The archive is a second query rather than a wider first one: the live list
    // is the hot path, and this only needs to answer "is there anything to
    // show, and how much". A failure here is silent — the archive link simply
    // does not appear, which must never take the block itself down.
    topicsApi.listArchived(supabase)
      .then(({ items, hasMore }) => { setArchived(items); setMoreArchived(hasMore); })
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

  // Ticking the box files the topic away. There is one place for a finished
  // topic now — Past topics — so this moves it there rather than parking it in
  // a second list on the way.
  async function archive(id) {
    setError('');
    try {
      const filed = await topicsApi.archive(supabase, id);
      setTopics(t => t.filter(x => x.id !== id));
      setArchived(a => [filed, ...a]);
    } catch (err) {
      console.error('[Topics] archive:', err?.message);
      setError('Could not file the topic away: ' + (err?.message || 'unknown error'));
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
  // checked by definition, and a checked row is not pending — un-archiving
  // alone would leave it visible nowhere at all.
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
  const dayLabel = ({ date, source, items }) => {
    const count = ` · ${items.length}`;
    if (!date) return `Undated${count}`;
    const when = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    // Every heading would otherwise read "Archived", which is noise on a list
    // of archived topics. Only the weaker claim — a date that is really just
    // when the thought was captured — needs saying out loud.
    return `${source === 'archived_at' ? '' : 'Added '}${when}${count}`;
  };

  const dayKey    = g => g.date ?? 'undated';
  const isDayOpen = (g, i) => (openDays ? openDays.has(dayKey(g)) : i === 0);
  const toggleDay = (g) => setOpenDays(prev => {
    const next = new Set(prev ?? (archiveGroups[0] ? [dayKey(archiveGroups[0])] : []));
    if (next.has(dayKey(g))) next.delete(dayKey(g)); else next.add(dayKey(g));
    return next;
  });

  // "Show all" is a deliberate second query, not a bigger first one.
  async function showAllArchived() {
    if (loadingAll) return;
    setLoadingAll(true);
    try {
      const { items } = await topicsApi.listArchived(supabase, { limit: null });
      setArchived(items);
      setMoreArchived(false);
    } catch (err) {
      console.error('[Topics] archive all:', err?.message);
      setError('Could not load the rest of the archive: ' + (err?.message || 'unknown error'));
    } finally { setLoadingAll(false); }
  }

  const pending = pendingTopics(topics);

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
      <button onClick={() => archive(topic.id)}
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

      <div style={{ display: 'flex', gap: 7, marginBottom: pending.length ? 10 : 0 }}>
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

      {!loading && pending.length === 0 && archived.length === 0 && (
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

      {/* The way in is a full-width row, not a line of text. Colour and weight
          were not enough on their own: at 13px among topics also set at 13px it
          still read as a caption, and it sits below a list that often runs to
          fifteen or twenty rows. Borrowing the topic rows' own frame — same
          background, border and radius — makes it obviously a thing you press,
          and the explicit Show/Hide in the accent says what pressing it does.

          The archive: what past sessions actually raised. Collapsed by default —
          it is a record to look back on, not part of the daily job of the
          block. Nothing is shown at all until there is something in it.

          Readability is the point here, and it is why these rows are body
          colour at 0.75 rather than MUTED. MUTED is already tuned to sit just
          above the contrast floor (see timeTheme.js), so dimming it further
          fails badly: MUTED at 0.75 measures 2.19 / 2.60 / 3.35 across
          morning / day / evening, against the 4.5:1 needed at this size.

          Body colour at 0.75 measures 4.78 / 5.58 / 7.85 — recessed to the eye,
          still legible on the pale morning ground and the indigo evening one.
          0.70 was the first choice and is why the number is not rounder: it
          measures 4.20 in morning, just under the floor. The accent tick is not
          dimmed at all (3.34 / 5.16 / 6.00, over the 3:1 a glyph needs). */}
      {archiveGroups.length > 0 && (
        <>
          <button onClick={() => setShowArchived(v => !v)}
            aria-expanded={showArchived}
            style={{
              marginTop: pending.length ? 14 : 0, width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: BG, border: `1px solid ${BORDER}`, borderRadius: 9,
              padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 13.5, fontWeight: 600, color: TEXT, textAlign: 'left',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = A}
            onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}>
            <span>Past topics · {archived.length}</span>
            <span style={{ color: A, fontSize: 12, fontWeight: 500 }}>
              {showArchived ? 'Hide ▾' : 'Show ▸'}
            </span>
          </button>

          {showArchived && (
            <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {archiveGroups.map((group, i) => {
                const open = isDayOpen(group, i);
                return (
                  <div key={dayKey(group)}>
                    {/* Days are folded because the archive is read backwards:
                        the last session is what you came for, the rest is
                        history you occasionally go looking through. */}
                    <button onClick={() => toggleDay(group)}
                      aria-expanded={open}
                      style={{ background: 'none', border: 'none', padding: 0, margin: '0 0 6px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                      {dayLabel(group)} <span style={{ fontSize: 9, opacity: 0.7 }}>{open ? '▾' : '▸'}</span>
                    </button>

                    {open && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {group.items.map(topic => (
                          <div key={topic.id} style={row}
                            onMouseEnter={() => setHoverId(topic.id)}
                            onMouseLeave={() => setHoverId(h => (h === topic.id ? null : h))}>
                            <span aria-hidden="true"
                              style={{ width: 17, height: 17, borderRadius: 5, flexShrink: 0, background: A, color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>✓</span>
                            <p style={{ fontSize: 13, color: TEXT, opacity: 0.75, margin: 0, flex: 1, lineHeight: 1.45, textDecoration: 'line-through', minWidth: 0 }}>
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
                    )}
                  </div>
                );
              })}

              {moreArchived && (
                <button onClick={showAllArchived} disabled={loadingAll}
                  style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, color: A, fontSize: 12.5, cursor: loadingAll ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                  {loadingAll ? 'Loading…' : 'Show all'}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
