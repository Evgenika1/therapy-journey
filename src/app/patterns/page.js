'use client';
import { useState, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { sessions as sessionsApi, emotions as emotionsApi } from '@/lib/api';
import {
  MIN_ANALYSED_SESSIONS, PATTERN_SECTIONS,
  analysedSessions, buildPatternsInput, cacheSignature, isStale, hasAnyPattern,
} from '@/lib/patternsInput';

// The analysis is a single Claude call over the entire history, so the result is
// kept and only recomputed on request. Held per browser rather than in the
// database: it is derived data, losing it costs nothing but a re-run, and this
// way the feature needs no migration.
const CACHE_KEY = 'miru_patterns_analysis';

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveCache(entry) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(entry)); } catch { /* private mode */ }
}

export default function PatternsPage() {
  const { supabase, user } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL: A, ACCENT_DEEP, isDark } = useTheme();

  const [sessions, setSessions] = useState([]);
  const [emotions, setEmotions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [cached,   setCached]   = useState(null);
  const [running,  setRunning]  = useState(false);
  const [error,    setError]    = useState('');

  useEffect(() => {
    if (!supabase) return;
    setCached(loadCache());
    Promise.all([sessionsApi.list(supabase), emotionsApi.list(supabase)])
      .then(([s, e]) => { setSessions(s); setEmotions(e); })
      .catch(err => {
        console.error('[Patterns] load:', err?.message);
        setError('Could not load your history: ' + (err?.message || 'unknown error'));
      })
      .finally(() => setLoading(false));
  }, [supabase]);

  const analysed = analysedSessions(sessions);
  const enough   = analysed.length >= MIN_ANALYSED_SESSIONS;
  const stale    = cached && isStale(cached, sessions);

  const run = useCallback(async () => {
    if (running || !enough) return;
    setRunning(true); setError('');
    try {
      const history = buildPatternsInput(sessions, emotions);
      const res = await fetch('/api/patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      const entry = {
        analysis: data.analysis,
        signature: cacheSignature(sessions),
        at: new Date().toISOString(),
      };
      setCached(entry);
      saveCache(entry);
    } catch (err) {
      console.error('[Patterns]', err);
      setError(err.message || 'Could not find patterns');
    } finally { setRunning(false); }
  }, [running, enough, sessions, emotions]);

  const analysis = cached?.analysis;

  // ── shared bits ────────────────────────────────────────────────────────────
  const card = {
    background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '20px 24px',
  };
  const primaryBtn = (on) => ({
    padding: '11px 30px', borderRadius: 999, border: 'none',
    background: on ? ACCENT_DEEP : BORDER, color: on && isDark ? BG : '#fff',
    fontSize: 14, fontWeight: 500, cursor: on ? 'pointer' : 'default', letterSpacing: '0.02em',
  });

  return (
    <AppLayout>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: BG, fontFamily: 'var(--font-sans)', color: TEXT, paddingBottom: 60 }}>
        <div style={{ padding: 32, maxWidth: 820, margin: '0 auto' }}>

          <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 38, fontWeight: 400, color: TEXT, margin: '0 0 6px', lineHeight: 1.2 }}>
              What <em style={{ fontStyle: 'italic' }}>repeats</em>
            </h1>
            <p style={{ fontSize: 15, color: MUTED, margin: 0, lineHeight: 1.6 }}>
              What only shows up when your sessions are read together, rather than one at a time.
            </p>
          </div>

          {loading && <p style={{ color: MUTED }}>Loading…</p>}

          {/* Not enough history yet */}
          {!loading && !enough && (
            <div style={{ ...card, textAlign: 'center', padding: '48px 28px' }}>
              <div style={{ fontSize: 30, color: A, marginBottom: 14 }}>◎</div>
              <p style={{ fontFamily: 'var(--font-serif)', fontSize: 22, color: TEXT, margin: '0 0 10px' }}>
                Need at least {MIN_ANALYSED_SESSIONS} analysed sessions to find patterns
              </p>
              <p style={{ fontSize: 14, color: MUTED, margin: 0, lineHeight: 1.7 }}>
                Analysed so far: <strong style={{ color: A }}>{analysed.length}</strong> of {sessions.length}.
                Patterns are built from session analyses — open a session and press Analyse
                to add it to the history.
              </p>
            </div>
          )}

          {/* Ready to analyse */}
          {!loading && enough && (
            <>
              <div style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, marginBottom: 20, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <p className="ritual-label" style={{ margin: '0 0 6px' }}>
                    {analysed.length} analysed {analysed.length === 1 ? 'session' : 'sessions'}
                  </p>
                  <p style={{ fontSize: 13.5, color: MUTED, margin: 0, lineHeight: 1.6 }}>
                    {!analysis
                      ? 'Your history is ready — patterns can be traced across it now.'
                      : stale
                        ? 'New sessions have arrived since the last run.'
                        : `Last run: ${new Date(cached.at).toLocaleDateString('en-US', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`}
                  </p>
                </div>
                <button onClick={run} disabled={running} style={primaryBtn(!running)}>
                  {running ? '⏳ Finding patterns…' : analysis ? '↻ Refresh' : '✦ Analyse patterns'}
                </button>
              </div>

              {stale && !running && (
                <p style={{ fontSize: 13, color: A, margin: '0 0 18px', lineHeight: 1.6 }}>
                  ↻ Showing the previous run. Press Refresh to include the new sessions.
                </p>
              )}

              {error && (
                <div style={{ ...card, borderColor: `${A}66`, marginBottom: 20 }}>
                  <p style={{ fontSize: 13.5, color: MUTED, margin: 0, lineHeight: 1.6 }}>⚠ {error}</p>
                </div>
              )}

              {running && !analysis && (
                <div style={{ ...card, textAlign: 'center', padding: '44px 28px' }}>
                  <p style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 20, color: TEXT, margin: '0 0 8px' }}>
                    Reading everything at once…
                  </p>
                  <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
                    Working through the whole history takes a few seconds.
                  </p>
                </div>
              )}

              {analysis && !hasAnyPattern(analysis) && (
                <div style={{ ...card }}>
                  <p style={{ fontSize: 14.5, color: MUTED, margin: 0, lineHeight: 1.7 }}>
                    Nothing steady has formed yet — the sessions are still too different.
                    That is normal this early: patterns surface as the history grows.
                  </p>
                </div>
              )}

              {/* The four blocks */}
              {analysis && hasAnyPattern(analysis) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                  {PATTERN_SECTIONS.map(({ key, label, icon, fields }) => {
                    const items = Array.isArray(analysis[key]) ? analysis[key] : [];
                    if (items.length === 0) return null;
                    const [head, second, third] = fields;
                    return (
                      <section key={key}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '0 0 12px' }}>
                          <span style={{ fontSize: 15, color: A }}>{icon}</span>
                          <span className="ritual-label">{label}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {items.map((item, i) => (
                            <div key={i} style={{ ...card, borderLeft: `3px solid ${A}` }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                                <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 400, color: TEXT, margin: 0, lineHeight: 1.35 }}>
                                  {item?.[head]}
                                </h2>
                                {/* Frequency reads as a quiet counter, not a headline */}
                                {key === 'recurring_themes' && item?.[second] && (
                                  <span style={{ fontSize: 12.5, color: A, fontWeight: 600, whiteSpace: 'nowrap', letterSpacing: '0.03em' }}>
                                    {item[second]}
                                  </span>
                                )}
                              </div>
                              {(key === 'recurring_themes' ? item?.[third] : item?.[second]) && (
                                <p style={{ fontSize: 14.5, color: MUTED, margin: '10px 0 0', lineHeight: 1.75 }}>
                                  {key === 'recurring_themes' ? item[third] : item[second]}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
