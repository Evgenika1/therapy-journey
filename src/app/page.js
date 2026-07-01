'use client';
import { useState, useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { sessions as sessionsApi, emotions as emotionsApi } from '@/lib/api';
import Link from 'next/link';

const MOOD_EMOJIS = ['😞', '😟', '😐', '🙂', '😊'];

function StatCard({ label, value, sub, color, BORDER, BG, MUTED, CORAL }) {
  return (
    <div style={{ background: BG, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${color || CORAL}`, borderRadius: 12, padding: 20 }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</p>
      <p style={{ fontFamily: '"Fraunces", serif', fontSize: 32, fontWeight: 300, color: color || CORAL, margin: 0, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: MUTED, margin: '6px 0 0' }}>{sub}</p>}
    </div>
  );
}

function MoodRow({ label, value, onChange, CORAL, BORDER, MUTED }) {
  return (
    <div>
      <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        {MOOD_EMOJIS.map((emoji, i) => {
          const active = value === i;
          return (
            <button key={i} onClick={() => onChange(i)}
              style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${active ? CORAL : BORDER}`, background: active ? CORAL + '18' : 'transparent', fontSize: 18, cursor: 'pointer', transition: 'all 0.12s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {emoji}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function HomePage() {
  const { supabase, user } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL, NAV_ACTIVE } = useTheme();
  const [stats,      setStats]      = useState(null);
  const [moodBefore, setMoodBefore] = useState(null);
  const [moodAfter,  setMoodAfter]  = useState(null);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    if (!supabase) return;
    sessionsApi.stats(supabase)
      .then(s => { setStats(s); setLoading(false); })
      .catch(() => setLoading(false));
  }, [supabase]);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <AppLayout>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: BG, fontFamily: '"Plus Jakarta Sans", sans-serif', color: TEXT, paddingBottom: 60 }}>
        <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>

          {/* Header */}
          <div style={{ marginBottom: 36 }}>
            <p style={{ fontSize: 13, color: MUTED, margin: '0 0 4px' }}>{greeting()}</p>
            <h1 style={{ fontFamily: '"Fraunces", serif', fontSize: 36, fontWeight: 300, color: TEXT, margin: 0, lineHeight: 1.2 }}>
              How are you feeling<br />today?
            </h1>
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 32 }}>
            <StatCard label="Sessions" value={loading ? '—' : stats?.total ?? 0} sub="total recorded" BORDER={BORDER} BG={BG} MUTED={MUTED} CORAL={CORAL} />
            <StatCard label="Avg Mood Lift" value={loading ? '—' : stats?.avgLift ? `+${stats.avgLift}` : '—'} sub="before → after" BORDER={BORDER} BG={BG} MUTED={MUTED} CORAL={CORAL} />
            <StatCard label="Insights" value={loading ? '—' : stats?.breakthroughs ?? 0} sub="AI analyses" BORDER={BORDER} BG={BG} MUTED={MUTED} CORAL={CORAL} />
          </div>

          {/* Mood tracking */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 28, marginBottom: 24 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: MUTED, margin: '0 0 20px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Today's Mood</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <MoodRow label="Mood before session" value={moodBefore} onChange={setMoodBefore} CORAL={CORAL} BORDER={BORDER} MUTED={MUTED} />
              <MoodRow label="Mood after session"  value={moodAfter}  onChange={setMoodAfter}  CORAL={CORAL} BORDER={BORDER} MUTED={MUTED} />
            </div>
          </div>

          {/* Quick actions */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }}>
            {[
              { href: '/sessions',     label: 'Record Session',   icon: '🎙', desc: 'Start a new recording' },
              { href: '/emotions',     label: 'Log Emotion',      icon: '💜', desc: 'Track how you feel' },
              { href: '/next-session', label: 'Next Session',     icon: '📋', desc: 'Prepare topics' },
              { href: '/ai-chat',      label: 'AI Chat',          icon: '🤖', desc: 'Talk to your AI companion' },
            ].map(({ href, label, icon, desc }) => (
              <Link key={href} href={href} style={{ textDecoration: 'none' }}>
                <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '18px 20px', cursor: 'pointer', transition: 'border-color 0.12s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = CORAL}
                  onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}>
                  <span style={{ fontSize: 24 }}>{icon}</span>
                  <p style={{ fontSize: 15, fontWeight: 500, color: TEXT, margin: '10px 0 3px' }}>{label}</p>
                  <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>{desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
