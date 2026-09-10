'use client';
//
// What the app actually costs to run, per account, this month.
//
// The other side of the same ledger the Dashboard reads: users see one number
// in minutes, this sees the dollars underneath it, split by where they went.
//
// Access is not enforced here. The page asks the database whether the caller is
// an admin and hides itself if not, but the real fence is the RLS policy on
// usage_events — a non-admin who loads this route gets their own rows and
// nobody else's, because that is all the database will hand over. A bug in this
// component cannot leak another account's therapy data.

import { useState, useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { allUsage, amIAdmin } from '@/lib/usageClient';
import { MONTHLY_MINUTES, USD_PER_MINUTE } from '@/lib/usageQuota';
import { ASSEMBLYAI_USD_PER_HOUR } from '@/lib/usagePricing';

const usd = n => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const mins = s => `${Math.round(s / 60)}m`;

export default function AdminPage() {
  const { supabase } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL: A, ERR } = useTheme();

  const [isAdmin, setIsAdmin] = useState(null); // null = still asking
  const [rows,    setRows]    = useState([]);
  const [error,   setError]   = useState('');

  useEffect(() => {
    if (!supabase) return;
    amIAdmin(supabase).then(ok => {
      setIsAdmin(ok);
      if (!ok) return;
      allUsage(supabase)
        .then(setRows)
        .catch(e => setError(e?.message || 'Could not load usage'));
    });
  }, [supabase]);

  const total = rows.reduce((sum, r) => sum + r.costUsd, 0);

  const cell = { padding: '9px 12px', fontSize: 13, color: TEXT, textAlign: 'left', verticalAlign: 'top' };
  const head = { ...cell, fontSize: 10.5, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' };

  return (
    <AppLayout>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: BG, color: TEXT, fontFamily: '"Plus Jakarta Sans", sans-serif' }}>
        <div style={{ padding: '22px 26px', maxWidth: 900, margin: '0 auto' }}>

          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 400, margin: '0 0 4px' }}>
            Usage this month
          </h1>
          <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 18px', lineHeight: 1.5 }}>
            What every account has spent since the 1st, in real money.
          </p>

          {isAdmin === null && <p style={{ fontSize: 13, color: MUTED }}>Checking…</p>}

          {isAdmin === false && (
            <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.6 }}>
              This page is for administrators. If you were expecting to see it, your
              account is not on the admin list.
            </p>
          )}

          {error && <p style={{ fontSize: 12.5, color: ERR, margin: '0 0 12px' }}>⚠ {error}</p>}

          {isAdmin && (
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                {[
                  ['TOTAL', usd(total)],
                  ['ACCOUNTS', String(rows.length)],
                  ['QUOTA', `${MONTHLY_MINUTES} min`],
                ].map(([label, value]) => (
                  <div key={label} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '11px 15px', minWidth: 120 }}>
                    <p style={{ fontSize: 10, fontWeight: 600, color: MUTED, margin: '0 0 4px', letterSpacing: '0.07em' }}>{label}</p>
                    <p style={{ fontSize: 20, margin: 0, color: A }}>{value}</p>
                  </div>
                ))}
              </div>

              <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <th style={head}>Account</th>
                      <th style={head}>Cost</th>
                      <th style={head}>Minutes used</th>
                      <th style={head}>Audio</th>
                      <th style={head}>Tokens in / out</th>
                      <th style={head}>Transcribe / Analyse / Chat / Patterns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.userId} style={{ borderBottom: `1px solid ${BORDER}` }}>
                        {/* The id, not an email: this table never needs to know who
                            someone is to show what they cost. */}
                        <td style={{ ...cell, fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>
                          {r.userId.slice(0, 8)}…
                        </td>
                        <td style={{ ...cell, color: A }}>{usd(r.costUsd)}</td>
                        <td style={{ ...cell, color: r.status === 'blocked' ? ERR : TEXT }}>
                          {Math.round(r.usedMinutes)} / {MONTHLY_MINUTES}
                          {r.status !== 'ok' && (
                            <span style={{ fontSize: 11, color: ERR, marginLeft: 6 }}>{r.status}</span>
                          )}
                        </td>
                        <td style={cell}>{mins(r.audioSeconds)}</td>
                        <td style={cell}>{r.inputTokens.toLocaleString()} / {r.outputTokens.toLocaleString()}</td>
                        <td style={{ ...cell, fontSize: 11.5, color: MUTED }}>
                          {usd(r.byKind.transcribe)} · {usd(r.byKind.analyze)} · {usd(r.byKind.chat)} · {usd(r.byKind.patterns)}
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && !error && (
                      <tr><td style={{ ...cell, color: MUTED }} colSpan={6}>Nothing spent yet this month.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* The rate is a guess until it is checked against a real invoice,
                  and every minutes figure above and on every user's dashboard is
                  proportional to it. Saying so here is cheaper than discovering
                  it from a surprising bill. */}
              <p style={{ fontSize: 11.5, color: MUTED, margin: '14px 0 0', lineHeight: 1.6 }}>
                Minutes are derived from cost at {usd(USD_PER_MINUTE)}/min, anchored to
                an AssemblyAI rate of ${ASSEMBLYAI_USD_PER_HOUR.toFixed(2)}/hour. That rate is a
                placeholder in <code>src/lib/usagePricing.js</code> — set it from your
                invoice before trusting any minutes figure.
              </p>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
