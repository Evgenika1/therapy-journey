'use client';
import { useState, useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { sessions as sessionsApi, emotions as emotionsApi } from '@/lib/api';

const MOOD_EMOJIS = ['😞','😟','😐','🙂','😊'];
function moodEmoji(intensity) {
  if (intensity <= 2) return '😞';
  if (intensity <= 4) return '😟';
  if (intensity <= 6) return '😐';
  if (intensity <= 8) return '🙂';
  return '😊';
}

export default function ProgressPage() {
  const { supabase } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL: A, GREEN } = useTheme();
  const [stats,        setStats]        = useState(null);
  const [sessionPairs, setSessionPairs] = useState([]);
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    if (!supabase) return;
    Promise.all([
      sessionsApi.stats(supabase),
      emotionsApi.sessionPairs(supabase),
    ]).then(([s, pairs]) => {
      setStats(s);
      setSessionPairs(pairs);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [supabase]);

  const avgDiff = sessionPairs.length
    ? (sessionPairs.reduce((a, p) => a + p.diff, 0) / sessionPairs.length).toFixed(1)
    : null;

  return (
    <AppLayout>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: BG, fontFamily: '"Plus Jakarta Sans", sans-serif', color: TEXT, paddingBottom: 60 }}>
        <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>
          <div style={{ marginBottom: 32 }}>
            <h1 style={{ fontFamily: '"Fraunces", serif', fontSize: 32, fontWeight: 300, color: TEXT, margin: '0 0 4px' }}>Progress</h1>
            <p style={{ fontSize: 15, color: MUTED, margin: 0 }}>Your therapy journey at a glance</p>
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 28 }}>
            {[
              { label: 'Total Sessions',  value: loading ? '—' : stats?.total ?? 0 },
              { label: 'Avg Mood Lift',   value: loading ? '—' : stats?.avgLift ? `+${stats.avgLift}` : '—' },
              { label: 'AI Analyses',     value: loading ? '—' : stats?.breakthroughs ?? 0 },
            ].map(s => (
              <div key={s.label} style={{ background: BG, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${A}`, borderRadius: 12, padding: 20 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{s.label}</p>
                <p style={{ fontFamily: '"Fraunces", serif', fontSize: 32, fontWeight: 300, color: A, margin: 0 }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Session mood impact */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 28, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: 0, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Session Impact</p>
              {avgDiff && (
                <span style={{ fontSize: 13, fontWeight: 500, color: Number(avgDiff) >= 0 ? '#15803D' : '#DC2626' }}>
                  avg {Number(avgDiff) >= 0 ? '+' : ''}{avgDiff} per session
                </span>
              )}
            </div>

            {loading && <p style={{ color: MUTED }}>Loading…</p>}
            {!loading && sessionPairs.length === 0 && (
              <p style={{ color: MUTED, fontSize: 14 }}>No before/after mood data yet. Log your mood before and after a session to see impact here.</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sessionPairs.map(p => {
                const pct = Math.min(100, Math.max(0, (p.after.intensity / 10) * 100));
                const positive = p.diff >= 0;
                return (
                  <div key={p.day} style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, color: MUTED }}>{new Date(p.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 18 }}>{moodEmoji(p.before.intensity)}</span>
                        <span style={{ fontSize: 12, color: MUTED }}>→</span>
                        <span style={{ fontSize: 18 }}>{moodEmoji(p.after.intensity)}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: positive ? '#15803D' : '#DC2626', minWidth: 36, textAlign: 'right' }}>
                          {positive ? '+' : ''}{p.diff}
                        </span>
                      </div>
                    </div>
                    <div style={{ height: 4, background: BORDER, borderRadius: 2 }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: positive ? '#15803D' : '#DC2626', borderRadius: 2, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
