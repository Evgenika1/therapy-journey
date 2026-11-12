'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { myUsage, mySubscription } from '@/lib/usageClient';
import { PLANS, PLAN_ORDER, MINUTES_PER_SESSION, subscriptionGrants, sessionsFromMinutes } from '@/lib/plans';

// Plans and the current subscription. Payment itself happens on Stripe's pages
// (Checkout to subscribe, the Customer Portal to change or cancel); this page
// only starts them and shows what came back through the webhook.

const INCLUDED = [
  'Recording or upload, transcribed',
  'AI analysis, patterns and homework',
  'AI chat about your sessions',
];

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const fmtSessions = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function BillingInner() {
  const { supabase, user } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL, ERR, GREEN, NAV_ACTIVE, isDark } = useTheme();
  const params = useSearchParams();
  const returnedFromCheckout = params.get('checkout') === 'success';

  const [sub, setSub] = useState(null);
  const [usage, setUsage] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(null); // plan id or 'portal' while a redirect is being prepared
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(returnedFromCheckout);

  const load = useCallback(async () => {
    if (!supabase || !user) return null;
    const [s, u] = await Promise.all([
      mySubscription(supabase).catch(e => { console.error('[Billing] subscription:', e?.message); return null; }),
      myUsage(supabase).catch(e => { console.error('[Billing] usage:', e?.message); return null; }),
    ]);
    setSub(s); setUsage(u); setLoaded(true);
    return s;
  }, [supabase, user]);

  useEffect(() => { load(); }, [load]);

  // Back from Checkout before the webhook has landed: look again for up to
  // thirty seconds rather than showing the plans as if nothing was bought.
  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    const t = setInterval(async () => {
      tries += 1;
      const s = await load();
      if (subscriptionGrants(s) || tries >= 15) { clearInterval(t); setWaiting(false); }
    }, 2000);
    return () => clearInterval(t);
  }, [waiting, load]);

  async function go(endpoint, body, key) {
    setBusy(key); setError('');
    try {
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Something went wrong. Please try again.');
      window.location.assign(data.url);
    } catch (e) {
      setError(e.message);
      setBusy(null);
    }
  }

  const active = subscriptionGrants(sub);
  const current = active ? PLANS[sub.plan] : null;
  const override = usage?.allowance?.source === 'override';
  const quotaMinutes = usage?.quota ?? 0;
  const usedMinutes = Math.max(0, usage?.usedMinutes ?? 0);
  const usedSessions = sessionsFromMinutes(usedMinutes);
  const totalSessions = sessionsFromMinutes(quotaMinutes);
  const pct = quotaMinutes > 0 ? Math.min(100, (usedMinutes / quotaMinutes) * 100) : 0;
  const onText = isDark ? BG : '#fff';

  const card = { background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 24 };
  const primaryBtn = (disabled) => ({
    padding: '11px 18px', borderRadius: 10, border: 'none', width: '100%',
    background: disabled ? CORAL + '60' : CORAL, color: onText,
    fontSize: 14, fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
  });
  const secondaryBtn = {
    padding: '11px 18px', borderRadius: 10, border: `1px solid ${BORDER}`, width: '100%',
    background: 'transparent', color: TEXT, fontSize: 14, fontWeight: 500, cursor: 'pointer',
  };

  let statusLine = null;
  if (active) {
    if (sub.status === 'past_due') {
      statusLine = <span style={{ color: ERR }}>Your last payment failed. Update your card to keep your plan.</span>;
    } else if (sub.cancel_at_period_end) {
      statusLine = <>Cancels on {fmtDate(sub.current_period_end)}. You keep your sessions until then.</>;
    } else if (sub.current_period_end) {
      statusLine = <>Renews on {fmtDate(sub.current_period_end)}.</>;
    }
  }

  return (
    <AppLayout>
      <div style={{ flex: 1, overflowY: 'auto', background: BG, padding: 32 }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          <h1 style={{ fontSize: 28, fontWeight: 300, color: TEXT, margin: '0 0 8px', fontFamily: 'var(--font-serif)' }}>Billing</h1>
          <p style={{ fontSize: 13, color: MUTED, margin: '0 0 28px' }}>
            Plans are counted in sessions. One session is about {MINUTES_PER_SESSION} minutes of recording and AI.
          </p>

          {waiting && !active && (
            <div style={{ ...card, marginBottom: 20, color: TEXT, fontSize: 14 }}>Confirming your subscription…</div>
          )}
          {params.get('checkout') === 'cancel' && !active && (
            <div style={{ ...card, marginBottom: 20, color: MUTED, fontSize: 14 }}>Checkout was cancelled — nothing was charged.</div>
          )}
          {error && <p style={{ color: ERR, fontSize: 13, margin: '0 0 16px' }}>{error}</p>}

          {/* Current plan and what is left of it */}
          {loaded && (active || override) && (
            <div style={{ ...card, marginBottom: 28 }}>
              <div className="ritual-label" style={{ marginBottom: 10 }}>{active ? 'Current plan' : 'Your allowance'}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontSize: 24, color: TEXT, fontFamily: 'var(--font-serif)' }}>
                  {active ? `${current.name} · €${current.priceEur}/month` : 'Custom allowance'}
                </div>
                <div style={{ fontSize: 14, color: TEXT }}>
                  <strong>{fmtSessions(usedSessions)}</strong> of {fmtSessions(totalSessions)} sessions used
                </div>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: NAV_ACTIVE, margin: '14px 0 8px', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: usage?.status === 'ok' ? CORAL : ERR }} />
              </div>
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 16 }}>
                {Math.round(usedMinutes)} of {quotaMinutes} minutes
                {override && active && ' — your account has a custom allowance, which replaces the plan’s'}
                {statusLine && <> · {statusLine}</>}
              </div>
              {active && (
                <div style={{ maxWidth: 260 }}>
                  <button onClick={() => go('/api/stripe/portal', null, 'portal')} disabled={!!busy} style={secondaryBtn}>
                    {busy === 'portal' ? 'Opening…' : 'Manage subscription'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Plans */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16 }}>
            {PLAN_ORDER.map(id => {
              const p = PLANS[id];
              const isCurrent = active && sub.plan === id;
              return (
                <div key={id} style={{ ...card, display: 'flex', flexDirection: 'column', borderColor: isCurrent ? CORAL : BORDER, borderWidth: isCurrent ? 2 : 1 }}>
                  <div className="ritual-label" style={{ marginBottom: 12 }}>{p.name}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, color: TEXT }}>
                    <span style={{ fontSize: 34, fontFamily: 'var(--font-serif)' }}>€{p.priceEur}</span>
                    <span style={{ fontSize: 13, color: MUTED }}>/ month</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: TEXT, margin: '10px 0 2px' }}>{p.sessions} sessions a month</div>
                  <div style={{ fontSize: 12, color: MUTED, marginBottom: 16 }}>{p.minutes.toLocaleString('en-GB')} minutes</div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px', fontSize: 13, color: TEXT, lineHeight: 1.5, flex: 1 }}>
                    {INCLUDED.map(line => (
                      <li key={line} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                        <span style={{ color: GREEN }}>✓</span>{line}
                      </li>
                    ))}
                  </ul>
                  {isCurrent ? (
                    <button disabled style={{ ...secondaryBtn, cursor: 'default', color: MUTED }}>Current plan</button>
                  ) : active ? (
                    // Switching goes through the portal, which replaces the
                    // subscription instead of adding a second one.
                    <button onClick={() => go('/api/stripe/portal', null, 'portal')} disabled={!!busy} style={secondaryBtn}>
                      {busy === 'portal' ? 'Opening…' : `Switch to ${p.name}`}
                    </button>
                  ) : (
                    <button onClick={() => go('/api/stripe/checkout', { plan: id }, id)} disabled={!!busy || !loaded} style={primaryBtn(!!busy || !loaded)}>
                      {busy === id ? 'Redirecting…' : 'Subscribe'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <p style={{ fontSize: 12, color: MUTED, margin: '20px 0 0', lineHeight: 1.6 }}>
            Prices include VAT where applicable. Billed monthly through Stripe; cancel anytime and keep your plan until the end
            of the period you paid for. Unused sessions do not carry over. Everything you have already recorded stays readable
            with or without a plan.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}

// useSearchParams needs a Suspense boundary to build as a static page.
export default function BillingPage() {
  return <Suspense><BillingInner /></Suspense>;
}
