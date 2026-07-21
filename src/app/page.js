'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { sessions as sessionsApi, emotions as emotionsApi } from '@/lib/api';

const MOOD_EMOJIS     = ['😞', '😟', '😐', '🙂', '😊'];
const MOOD_INTENSITIES = [2,    4,    6,    8,    10];

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

export default function HomePage() {
  const { supabase, user } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL } = useTheme();
  const router = useRouter();

  const [stats,         setStats]         = useState(null);
  const [latestInsight, setLatestInsight] = useState(null);
  const [moodBefore,    setMoodBefore]    = useState(null);
  const [sessionName,   setSessionName]   = useState(defaultSessionName);
  const [loading,       setLoading]       = useState(true);

  const userName = user?.user_metadata?.full_name
    || user?.email?.split('@')[0]
    || 'there';

  useEffect(() => {
    if (!supabase) return;
    Promise.all([
      sessionsApi.stats(supabase),
      sessionsApi.list(supabase),
    ]).then(([s, list]) => {
      setStats(s);
      const withAI = list.find(x => x.ai_analysis);
      if (withAI) {
        try {
          const parsed = typeof withAI.ai_analysis === 'string'
            ? JSON.parse(withAI.ai_analysis)
            : withAI.ai_analysis;
          setLatestInsight(parsed?.summary || (typeof withAI.ai_analysis === 'string' ? withAI.ai_analysis : null));
        } catch {
          setLatestInsight(typeof withAI.ai_analysis === 'string' ? withAI.ai_analysis : null);
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
    router.push(`/sessions?record=true${preMoodQuery}`);
  }

  const STAT_CARDS = [
    { label: 'SESSIONS',    value: loading ? '—' : String(stats?.total ?? 0),                              color: '#E8785A' },
    { label: 'AVG LIFT',    value: loading ? '—' : (stats?.avgLift ? `+${stats.avgLift}` : '—'),           color: '#3B82F6' },
    { label: 'AI ANALYSES', value: loading ? '—' : String(stats?.breakthroughs ?? 0),                      color: '#8B5CF6' },
    { label: 'ENCRYPTED',   value: '100%',                                                                  color: '#10B981' },
  ];

  return (
    <AppLayout>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: BG, fontFamily: '"Plus Jakarta Sans", sans-serif', color: TEXT, paddingBottom: 60 }}>
        <div style={{ padding: 32, maxWidth: 860, margin: '0 auto' }}>

          {/* ── Header ───────────────────────────────────────────────────────── */}
          <div style={{ marginBottom: 32 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, margin: '0 0 6px', letterSpacing: '0.09em', textTransform: 'uppercase' }}>
              {todayDate()}
            </p>
            <h1 style={{ fontSize: 28, fontWeight: 600, color: TEXT, margin: 0, lineHeight: 1.25, fontFamily: '"Plus Jakarta Sans", sans-serif' }}>
              {greeting()}, {userName} 👋
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
                  background: CORAL, border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 18px rgba(232,120,90,0.38)',
                  transition: 'transform 0.12s, box-shadow 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.07)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(232,120,90,0.48)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)';    e.currentTarget.style.boxShadow = '0 4px 18px rgba(232,120,90,0.38)'; }}
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
              <p style={{ fontSize: 10, fontWeight: 600, color: MUTED, margin: '0 0 12px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                ✦ LATEST AI INSIGHT
              </p>
              <p style={{ fontSize: 14, color: TEXT, margin: 0, lineHeight: 1.75, fontStyle: 'italic' }}>
                "{latestInsight}"
              </p>
            </div>
          ) : (
            <div style={{ background: SURFACE, borderRadius: 14, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `1px solid ${BORDER}` }}>
              <p style={{ fontSize: 10, fontWeight: 600, color: MUTED, margin: '0 0 10px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                ✦ LATEST AI INSIGHT
              </p>
              <p style={{ fontSize: 14, color: MUTED, margin: 0, lineHeight: 1.7 }}>
                No AI analyses yet — insights will appear here after your sessions are analysed.
              </p>
            </div>
          )}

        </div>
      </div>
    </AppLayout>
  );
}
