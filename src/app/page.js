'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { sessions as sessionsApi, emotions as emotionsApi } from '@/lib/api';
import { analysisHeadline } from '@/lib/analysisFormat';
import { MoodTrendChart, EmotionHeatmap } from '@/components/DashboardCharts';
import NextSessionTopics from '@/components/NextSessionTopics';
import { myUsage } from '@/lib/usageClient';

const MOOD_EMOJIS     = ['😞', '😟', '😐', '🙂', '😊'];
const MOOD_INTENSITIES = [2,    4,    6,    8,    10];

// How many session-impact rows show before the list is collapsed. Deliberately
// small: this list now sits ABOVE the record card, so every extra row pushes
// the one button the page exists for further down. Three is enough to show a
// direction; "show all" is one click away.
const IMPACT_PREVIEW = 3;

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function todayDate() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  }).toUpperCase();
}

function defaultSessionName() {
  return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' Session';
}

function moodEmoji(intensity) {
  if (intensity <= 2) return '😞';
  if (intensity <= 4) return '😟';
  if (intensity <= 6) return '😐';
  if (intensity <= 8) return '🙂';
  return '😊';
}

export default function HomePage() {
  const { supabase, user } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL, ACCENT_DEEP, GREEN, ERR, isDark } = useTheme();
  const router = useRouter();

  const [stats,         setStats]         = useState(null);
  const [usage,         setUsage]         = useState(null);
  const [latestInsight, setLatestInsight] = useState(null);
  const [sessionPairs,  setSessionPairs]  = useState([]);
  const [emotionLogs,   setEmotionLogs]   = useState([]);
  const [showAllPairs,  setShowAllPairs]  = useState(false);
  const [moodBefore,    setMoodBefore]    = useState(null);
  const [insightOpen,   setInsightOpen]   = useState(false);
  // Whether the insight is actually taller than its collapsed box. Measured
  // rather than guessed from the string length: the same character count wraps
  // to three lines or to five depending on the viewport, and a "Show more" that
  // reveals nothing is worse than no button at all.
  const [insightClamped, setInsightClamped] = useState(false);
  const insightRef = useRef(null);
  const [sessionName,   setSessionName]   = useState(defaultSessionName);
  const [loading,       setLoading]       = useState(true);

  const userName = user?.user_metadata?.full_name
    || user?.email?.split('@')[0]
    || 'there';

  useEffect(() => {
    // Failing to read the balance must not blank the dashboard, so this is its
    // own effect and its own catch: the card falls back to a dash.
    if (supabase) myUsage(supabase).then(setUsage).catch(e => console.error('[Dashboard] usage:', e?.message));
    if (!supabase) return;
    // moodPairs joins the former /progress page's data to this one: the whole
    // dashboard now loads in a single round of requests rather than two screens'
    // worth spread over two navigations.
    Promise.all([
      sessionsApi.stats(supabase),
      sessionsApi.list(supabase),
      sessionsApi.moodPairs(supabase),
      // The heatmap needs these on the first paint, so they ride along rather
      // than arriving in a second wave that makes the section jump.
      emotionsApi.list(supabase).catch(() => []),
    ]).then(([s, list, pairs, logs]) => {
      setStats(s);
      setSessionPairs(pairs);
      setEmotionLogs(logs);
      // This used to read `parsed.summary` — a field the analysis has never
      // contained — and fall through to the raw string, so the insight card
      // rendered the entire serialized JSON blob in quotes. analysisHeadline
      // picks a real field and returns null when there is nothing to show.
      const withAI = list.find(x => x.ai_analysis);
      if (withAI) {
        try {
          const parsed = typeof withAI.ai_analysis === 'string'
            ? JSON.parse(withAI.ai_analysis)
            : withAI.ai_analysis;
          setLatestInsight(analysisHeadline(parsed));
        } catch {
          setLatestInsight(null);
        }
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [supabase]);

  useEffect(() => {
    const el = insightRef.current;
    if (el) setInsightClamped(el.scrollHeight > el.clientHeight + 1);
  }, [latestInsight]);

  async function handleStartRecording() {
    let preMoodQuery = '';
    if (moodBefore !== null && user && supabase) {
      try {
        await emotionsApi.save(supabase, {
          category: 'Session', emotion_name: 'Before',
          intensity: MOOD_INTENSITIES[moodBefore], session_tag: 'before',
        });
        preMoodQuery = `&preMood=${MOOD_INTENSITIES[moodBefore]}`;
      } catch (e) { console.error('[Dashboard] mood save:', e?.message); }
    }
    const name = sessionName.trim();
    const nameQuery = name ? `&name=${encodeURIComponent(name)}` : '';
    router.push(`/sessions?record=true${preMoodQuery}${nameQuery}`);
  }

  // What the account has left this month. One number, deliberately: the four
  // things that cost money are converted to a single currency so there is one
  // figure to read rather than four meters nobody looks at. The honest cost of
  // that choice, said plainly in the caption: a long AI Chat does move it.
  const minutesLeft = usage
    ? `${Math.max(0, Math.round(usage.remaining))}`
    : '—';

  const STAT_CARDS = [
    { label: 'SESSIONS',    value: loading ? '—' : String(stats?.total ?? 0),                              color: 'var(--accent-deep)' },
    { label: 'AVG LIFT',    value: loading ? '—' : (stats?.avgLift ? `+${stats.avgLift}` : '—'),           color: 'var(--accent)' },
    { label: 'AI ANALYSES', value: loading ? '—' : String(stats?.breakthroughs ?? 0),                      color: 'var(--accent-deep)' },
    { label: 'MINUTES LEFT', value: minutesLeft,
      color: usage?.status === 'warn' ? 'var(--err)' : 'var(--accent-deep)' },
    { label: 'ENCRYPTED',   value: '100%',                                                                  color: 'var(--accent)' },
  ];

  const avgDiff = sessionPairs.length
    ? (sessionPairs.reduce((a, p) => a + p.diff, 0) / sessionPairs.length).toFixed(1)
    : null;

  const visiblePairs = showAllPairs ? sessionPairs : sessionPairs.slice(0, IMPACT_PREVIEW);

  return (
    <AppLayout>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: BG, fontFamily: '"Plus Jakarta Sans", sans-serif', color: TEXT, paddingBottom: 28 }}>
        <div style={{ padding: '22px 26px', maxWidth: 860, margin: '0 auto' }}>

          {/* ── Header ───────────────────────────────────────────────────────── */}
          <div style={{ marginBottom: 18 }}>
            <p style={{ fontSize: 10.5, fontWeight: 600, color: MUTED, margin: '0 0 4px', letterSpacing: '0.09em', textTransform: 'uppercase' }}>
              {todayDate()}
            </p>
            <h1 style={{ fontSize: 27, fontWeight: 400, color: TEXT, margin: 0, lineHeight: 1.2, fontFamily: 'var(--font-serif)' }}>
              {greeting()}, <em style={{ fontStyle: 'italic' }}>{userName}</em>
            </h1>
          </div>

          {/* ── Stat cards ───────────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 18 }}>
            {STAT_CARDS.map(({ label, value, color }) => (
              <div key={label} style={{
                background: SURFACE,
                borderRadius: 11,
                padding: '11px 14px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                border: `1px solid ${BORDER}`,
              }}>
                <p style={{ fontSize: 9.5, fontWeight: 600, color: MUTED, margin: '0 0 5px', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                  {label}
                </p>
                <p style={{ fontSize: 22, fontWeight: 700, color, margin: 0, lineHeight: 1, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* The primary action of the whole app, so it sits above everything
              that merely reports on it. It used to come after the Progress
              section — charts, emotion grid and the session-impact list — which
              put it off the bottom of the screen on a laptop.

              Above the topics block rather than below it: that list runs to
              fifteen or twenty rows, and anything after it is below the fold
              again. */}
          {/* ── Record card ──────────────────────────────────────────────────── */}
          <div style={{ background: SURFACE, borderRadius: 14, padding: '18px 22px', marginBottom: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${BORDER}` }}>

            {/* Session name */}
            <input
              value={sessionName}
              onChange={e => setSessionName(e.target.value)}
              style={{
                fontSize: 15, fontWeight: 500, color: TEXT,
                border: 'none', borderBottom: `1px solid ${BORDER}`,
                outline: 'none', background: 'transparent',
                width: '100%', paddingBottom: 6, marginBottom: 16,
                fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />

            {/* Mood before comes BEFORE the button, because handleStartRecording
                reads it and then navigates away — a control you must use first has
                no business sitting under the one that ends the screen.

                Centred to match the mic below it: left-aligned under a centred
                button, the row read as a mistake. */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 18 }}>
              <p style={{ fontSize: 10.5, fontWeight: 600, color: MUTED, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.09em', textAlign: 'center' }}>
                Mood before
              </p>
              <div style={{ display: 'flex', gap: 7, justifyContent: 'center' }}>
                {MOOD_EMOJIS.map((emoji, i) => (
                  <button key={i} onClick={() => setMoodBefore(moodBefore === i ? null : i)}
                    style={{
                      width: 34, height: 34, borderRadius: 9,
                      border: `1.5px solid ${moodBefore === i ? CORAL : BORDER}`,
                      background: moodBefore === i ? CORAL + '18' : 'transparent',
                      fontSize: 17, cursor: 'pointer', transition: 'all 0.1s',
                    }}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            {/* Mic button */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <button
                onClick={handleStartRecording}
                style={{
                  width: 58, height: 58, borderRadius: '50%',
                  background: ACCENT_DEEP, border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 5px 20px var(--glow)',
                  transition: 'transform 0.12s, box-shadow 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.07)'; e.currentTarget.style.boxShadow = '0 10px 34px var(--glow)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)';    e.currentTarget.style.boxShadow = '0 6px 26px var(--glow)'; }}
              >
                <svg width="23" height="23" viewBox="0 0 24 24" fill="none">
                  <rect x="9" y="2" width="6" height="12" rx="3" fill="white"/>
                  <path d="M5 10a7 7 0 0 0 14 0" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="12" y1="17" x2="12" y2="21" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <line x1="8"  y1="21" x2="16" y2="21" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
              <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>Tap to begin your therapy session</p>
            </div>
          </div>

          <NextSessionTopics />

          {/* ── Progress ──────────────────────────────────────────────────────
              Folded in from the standalone /progress screen, and kept high on
              the page: below the record card it opened 906px down a 990px
              viewport, so the section that replaced a whole screen was the one
              thing nobody saw. It reads with the stat cards above it — both
              answer "where am I", before the page asks anything of you. */}
          <section style={{ marginBottom: 18 }}>
            <div style={{ marginBottom: 10 }}>
              <p className="ritual-label" style={{ margin: '0 0 5px' }}>✦ Progress</p>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 300, color: TEXT, margin: '0 0 3px', lineHeight: 1.25 }}>
                Your therapy journey at a glance
              </h2>
            </div>

            {/* Two charts side by side; the grid collapses to one column on a
                narrow window (.dash-charts in globals.css). */}
            <div className="dash-charts">
              <MoodTrendChart pairs={sessionPairs} />
              <EmotionHeatmap emotions={emotionLogs} />
            </div>

            {/* Session mood impact */}
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, margin: 0, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Session Impact</p>
                {avgDiff && (
                  <span style={{ fontSize: 12, fontWeight: 500, color: Number(avgDiff) >= 0 ? GREEN : ERR }}>
                    avg {Number(avgDiff) >= 0 ? '+' : ''}{avgDiff} per session
                  </span>
                )}
              </div>

              {loading && <p style={{ color: MUTED }}>Loading…</p>}
              {!loading && sessionPairs.length === 0 && (
                <p style={{ color: MUTED, fontSize: 12.5, margin: 0 }}>No before/after mood data yet. Log your mood before and after a session to see impact here.</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {visiblePairs.map(p => {
                  const pct = Math.min(100, Math.max(0, (p.after / 10) * 100));
                  const positive = p.diff >= 0;
                  return (
                    <div key={p.id} style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 13px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: MUTED }}>{new Date(p.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16 }}>{moodEmoji(p.before)}</span>
                          <span style={{ fontSize: 12, color: MUTED }}>→</span>
                          <span style={{ fontSize: 16 }}>{moodEmoji(p.after)}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: positive ? GREEN : ERR, minWidth: 32, textAlign: 'right' }}>
                            {positive ? '+' : ''}{p.diff}
                          </span>
                        </div>
                      </div>
                      <div style={{ height: 4, background: BORDER, borderRadius: 2 }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: positive ? GREEN : ERR, borderRadius: 2, transition: 'width 0.3s' }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {sessionPairs.length > IMPACT_PREVIEW && (
                <button
                  onClick={() => setShowAllPairs(v => !v)}
                  style={{
                    marginTop: 10, background: 'none', border: 'none', padding: 0,
                    color: ACCENT_DEEP, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}>
                  {showAllPairs
                    ? 'Show less'
                    : `Show all ${sessionPairs.length} sessions`}
                </button>
              )}
            </div>
          </section>

          {/* ── Latest AI Insight ─────────────────────────────────────────────── */}
          {latestInsight ? (
            <div style={{ background: SURFACE, borderRadius: 12, padding: '14px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${BORDER}` }}>
              <p className="ritual-label" style={{ margin: '0 0 8px' }}>✦ Latest AI insight</p>
              {/* Collapsed to three lines by default. The analysis runs to a
                  paragraph, and at full height it was the tallest thing on the
                  page — for something the user reads once. */}
              <p ref={insightRef}
                style={{
                  fontFamily: 'var(--font-serif)', fontSize: 15, color: TEXT, margin: 0,
                  lineHeight: 1.55, fontStyle: 'italic',
                  ...(insightOpen ? {} : {
                    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }),
                }}>
                "{latestInsight}"
              </p>
              {(insightClamped || insightOpen) && (
                <button onClick={() => setInsightOpen(v => !v)}
                  style={{ marginTop: 7, background: 'none', border: 'none', padding: 0, color: ACCENT_DEEP, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {insightOpen ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          ) : (
            <div style={{ background: SURFACE, borderRadius: 12, padding: '14px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${BORDER}` }}>
              <p className="ritual-label" style={{ margin: '0 0 7px' }}>✦ Latest AI insight</p>
              <p style={{ fontSize: 12.5, color: MUTED, margin: 0, lineHeight: 1.6 }}>
                No AI analyses yet — insights will appear here after your sessions are analysed.
              </p>
            </div>
          )}


        </div>
      </div>
    </AppLayout>
  );
}
