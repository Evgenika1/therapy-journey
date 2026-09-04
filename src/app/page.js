'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { sessions as sessionsApi, emotions as emotionsApi } from '@/lib/api';
import { analysisHeadline } from '@/lib/analysisFormat';

const MOOD_EMOJIS     = ['😞', '😟', '😐', '🙂', '😊'];
const MOOD_INTENSITIES = [2,    4,    6,    8,    10];

// How many session-impact rows show before the list is collapsed. The dashboard
// carries the record card and the insight above this, so an unbounded list of
// every session ever logged would bury everything under it.
const IMPACT_PREVIEW = 6;

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
  const [latestInsight, setLatestInsight] = useState(null);
  const [sessionPairs,  setSessionPairs]  = useState([]);
  const [showAllPairs,  setShowAllPairs]  = useState(false);
  const [moodBefore,    setMoodBefore]    = useState(null);
  const [sessionName,   setSessionName]   = useState(defaultSessionName);
  const [loading,       setLoading]       = useState(true);

  const userName = user?.user_metadata?.full_name
    || user?.email?.split('@')[0]
    || 'there';

  useEffect(() => {
    if (!supabase) return;
    // moodPairs joins the former /progress page's data to this one: the whole
    // dashboard now loads in a single round of requests rather than two screens'
    // worth spread over two navigations.
    Promise.all([
      sessionsApi.stats(supabase),
      sessionsApi.list(supabase),
      sessionsApi.moodPairs(supabase),
    ]).then(([s, list, pairs]) => {
      setStats(s);
      setSessionPairs(pairs);
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

  const STAT_CARDS = [
    { label: 'SESSIONS',    value: loading ? '—' : String(stats?.total ?? 0),                              color: 'var(--accent-deep)' },
    { label: 'AVG LIFT',    value: loading ? '—' : (stats?.avgLift ? `+${stats.avgLift}` : '—'),           color: 'var(--accent)' },
    { label: 'AI ANALYSES', value: loading ? '—' : String(stats?.breakthroughs ?? 0),                      color: 'var(--accent-deep)' },
    { label: 'ENCRYPTED',   value: '100%',                                                                  color: 'var(--accent)' },
  ];

  const avgDiff = sessionPairs.length
    ? (sessionPairs.reduce((a, p) => a + p.diff, 0) / sessionPairs.length).toFixed(1)
    : null;

  const visiblePairs = showAllPairs ? sessionPairs : sessionPairs.slice(0, IMPACT_PREVIEW);

  return (
    <AppLayout>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: BG, fontFamily: '"Plus Jakarta Sans", sans-serif', color: TEXT, paddingBottom: 60 }}>
        <div style={{ padding: 32, maxWidth: 860, margin: '0 auto' }}>

          {/* ── Header ───────────────────────────────────────────────────────── */}
          <div style={{ marginBottom: 32 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, margin: '0 0 6px', letterSpacing: '0.09em', textTransform: 'uppercase' }}>
              {todayDate()}
            </p>
            <h1 style={{ fontSize: 38, fontWeight: 400, color: TEXT, margin: 0, lineHeight: 1.2, fontFamily: 'var(--font-serif)' }}>
              {greeting()}, <em style={{ fontStyle: 'italic' }}>{userName}</em>
            </h1>
          </div>

          {/* ── Stat cards ───────────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
            {STAT_CARDS.map(({ label, value, color }) => (
              <div key={label} style={{
                background: SURFACE,
                borderRadius: 12,
                padding: '16px 18px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                border: `1px solid ${BORDER}`,
              }}>
                <p style={{ fontSize: 10, fontWeight: 600, color: MUTED, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                  {label}
                </p>
                <p style={{ fontSize: 30, fontWeight: 700, color, margin: 0, lineHeight: 1, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* ── Record card ──────────────────────────────────────────────────── */}
          <div style={{ background: SURFACE, borderRadius: 16, padding: '28px 32px', marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${BORDER}` }}>

            {/* Session name */}
            <input
              value={sessionName}
              onChange={e => setSessionName(e.target.value)}
              style={{
                fontSize: 17, fontWeight: 500, color: TEXT,
                border: 'none', borderBottom: `1px solid ${BORDER}`,
                outline: 'none', background: 'transparent',
                width: '100%', paddingBottom: 8, marginBottom: 28,
                fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />

            {/* Mic button */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 32 }}>
              <button
                onClick={handleStartRecording}
                style={{
                  width: 80, height: 80, borderRadius: '50%',
                  background: ACCENT_DEEP, border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 6px 26px var(--glow)',
                  transition: 'transform 0.12s, box-shadow 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.07)'; e.currentTarget.style.boxShadow = '0 10px 34px var(--glow)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)';    e.currentTarget.style.boxShadow = '0 6px 26px var(--glow)'; }}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                  <rect x="9" y="2" width="6" height="12" rx="3" fill="white"/>
                  <path d="M5 10a7 7 0 0 0 14 0" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="12" y1="17" x2="12" y2="21" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <line x1="8"  y1="21" x2="16" y2="21" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
              <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>Tap to begin your therapy session</p>
            </div>

            {/* Mood before */}
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                Mood before
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                {MOOD_EMOJIS.map((emoji, i) => (
                  <button key={i} onClick={() => setMoodBefore(moodBefore === i ? null : i)}
                    style={{
                      width: 42, height: 42, borderRadius: 11,
                      border: `1.5px solid ${moodBefore === i ? CORAL : BORDER}`,
                      background: moodBefore === i ? CORAL + '18' : 'transparent',
                      fontSize: 20, cursor: 'pointer', transition: 'all 0.1s',
                    }}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Latest AI Insight ─────────────────────────────────────────────── */}
          {latestInsight ? (
            <div style={{ background: SURFACE, borderRadius: 14, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${BORDER}` }}>
              <p className="ritual-label" style={{ margin: '0 0 12px' }}>✦ Latest AI insight</p>
              <p style={{ fontFamily: 'var(--font-serif)', fontSize: 18, color: TEXT, margin: 0, lineHeight: 1.7, fontStyle: 'italic' }}>
                "{latestInsight}"
              </p>
            </div>
          ) : (
            <div style={{ background: SURFACE, borderRadius: 14, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${BORDER}` }}>
              <p className="ritual-label" style={{ margin: '0 0 10px' }}>✦ Latest AI insight</p>
              <p style={{ fontSize: 14, color: MUTED, margin: 0, lineHeight: 1.7 }}>
                No AI analyses yet — insights will appear here after your sessions are analysed.
              </p>
            </div>
          )}

          {/* ── Progress ──────────────────────────────────────────────────────
              Folded in from the standalone /progress screen. It sits below the
              act of recording because it reads as a look back, not a next step:
              the top of the page is for today, this is for the weeks behind it. */}
          <section style={{ marginTop: 52 }}>
            <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 28, marginBottom: 20 }}>
              <p className="ritual-label" style={{ margin: '0 0 8px' }}>✦ Progress</p>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 300, color: TEXT, margin: '0 0 4px', lineHeight: 1.25 }}>
                Your therapy journey at a glance
              </h2>
              <p style={{ fontSize: 14, color: MUTED, margin: 0 }}>
                How your mood moves across a session, from the first to the most recent.
              </p>
            </div>

            {/* Session mood impact */}
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: 0, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Session Impact</p>
                {avgDiff && (
                  <span style={{ fontSize: 13, fontWeight: 500, color: Number(avgDiff) >= 0 ? GREEN : ERR }}>
                    avg {Number(avgDiff) >= 0 ? '+' : ''}{avgDiff} per session
                  </span>
                )}
              </div>

              {loading && <p style={{ color: MUTED }}>Loading…</p>}
              {!loading && sessionPairs.length === 0 && (
                <p style={{ color: MUTED, fontSize: 14 }}>No before/after mood data yet. Log your mood before and after a session to see impact here.</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {visiblePairs.map(p => {
                  const pct = Math.min(100, Math.max(0, (p.after / 10) * 100));
                  const positive = p.diff >= 0;
                  return (
                    <div key={p.id} style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 13, color: MUTED }}>{new Date(p.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 18 }}>{moodEmoji(p.before)}</span>
                          <span style={{ fontSize: 12, color: MUTED }}>→</span>
                          <span style={{ fontSize: 18 }}>{moodEmoji(p.after)}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: positive ? GREEN : ERR, minWidth: 36, textAlign: 'right' }}>
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
                    marginTop: 14, background: 'none', border: 'none', padding: 0,
                    color: CORAL, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}>
                  {showAllPairs
                    ? 'Show less'
                    : `Show all ${sessionPairs.length} sessions`}
                </button>
              )}
            </div>
          </section>

        </div>
      </div>
    </AppLayout>
  );
}
