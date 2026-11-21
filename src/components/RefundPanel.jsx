'use client';
import { useState } from 'react';
import { useTheme } from '@/lib/ThemeContext';
import { WITHDRAWAL_DAYS } from '@/lib/refundPolicy';

// Admin: look a customer up by email, see what the refund policy says they are
// owed, and carry it out — refund and end the plan — in one step.
const money = (cents, cur = 'eur') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur.toUpperCase() }).format((cents || 0) / 100);

export default function RefundPanel() {
  const { SURFACE, BORDER, MUTED, H1: TEXT, CORAL: A, ERR, BG } = useTheme();
  const [email, setEmail] = useState('');
  const [ourFault, setOurFault] = useState(false);
  const [quote, setQuote] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | confirm | doing | done
  const [msg, setMsg] = useState('');

  async function check(e) {
    e?.preventDefault();
    if (!email.trim()) return;
    setState('loading'); setMsg(''); setQuote(null);
    const q = new URLSearchParams({ email: email.trim(), ...(ourFault ? { our_fault: '1' } : {}) });
    const r = await fetch(`/api/admin/refund?${q}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j.error || 'Could not look this up.'); setState('idle'); return; }
    setQuote(j); setState('idle');
  }

  async function run() {
    setState('doing'); setMsg('');
    const r = await fetch('/api/admin/refund', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), ourFault, amountCents: quote.amountCents }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j.error || 'Refund failed.'); if (j.quote) setQuote(j.quote); setState('idle'); return; }
    setMsg(j.refundedCents > 0
      ? `Refunded ${money(j.refundedCents, quote.currency)} and ended the plan. The money reaches the card in 5–10 days.`
      : 'Ended the plan. Nothing was due back, so nothing was refunded.');
    setState('done');
  }

  const box = { background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 18px', marginTop: 24 };
  const btn = (primary) => ({ padding: '7px 14px', borderRadius: 8, border: primary ? 'none' : `1px solid ${BORDER}`, background: primary ? A : 'transparent', color: primary ? '#fff' : TEXT, fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer' });

  return (
    <div style={box}>
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px', color: TEXT }}>Refund a customer</h2>
      <p style={{ fontSize: 12, color: MUTED, margin: '0 0 12px', lineHeight: 1.5 }}>
        Within {WITHDRAWAL_DAYS} days of the payment the unused share comes back; after that, nothing.
        A failure on our side refunds everything. Refunding also ends the plan at once.
      </p>
      <form onSubmit={check} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="email" value={email} onChange={e => { setEmail(e.target.value); setQuote(null); setState('idle'); }}
          placeholder="customer@email" aria-label="Customer email"
          style={{ flex: '1 1 220px', padding: '7px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 13, fontFamily: 'inherit' }} />
        <label style={{ fontSize: 12, color: TEXT, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={ourFault} onChange={e => { setOurFault(e.target.checked); setQuote(null); }} />
          Our fault (full refund)
        </label>
        <button type="submit" disabled={state === 'loading'} style={btn(false)}>{state === 'loading' ? 'Checking…' : 'Check'}</button>
      </form>

      {msg && <p style={{ fontSize: 12.5, color: state === 'done' ? A : ERR, margin: '12px 0 0' }}>{msg}</p>}

      {quote && state !== 'done' && (
        <div style={{ marginTop: 14, fontSize: 13, color: TEXT, lineHeight: 1.7 }}>
          <div>{quote.plan} · {quote.status}{quote.cancelAtPeriodEnd ? ' (set to cancel)' : ''} · invoice {quote.invoiceNumber}</div>
          <div>Paid {money(quote.paidCents, quote.currency)} on {new Date(quote.paidAt).toLocaleDateString('en-GB')} — {quote.days} day{quote.days === 1 ? '' : 's'} ago
            {quote.withinWithdrawal ? ' (within 14 days)' : ' (past 14 days)'}</div>
          <div>Used {Math.round(quote.usedMinutes)} of {quote.planMinutes} minutes since paying</div>
          {quote.refundedCents > 0 && <div>Already refunded: {money(quote.refundedCents, quote.currency)}</div>}
          <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>
            Refund due: {money(quote.amountCents, quote.currency)}
          </div>
          {!quote.canRefund && <div style={{ color: ERR, fontSize: 12 }}>No payment found on the invoice — refund it in Stripe.</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {state === 'confirm' || state === 'doing' ? (
              <>
                <span style={{ fontSize: 12.5, alignSelf: 'center' }}>
                  {quote.amountCents > 0 ? `Refund ${money(quote.amountCents, quote.currency)} and end the plan now?` : 'End the plan now, with no refund?'} This cannot be undone.
                </span>
                <button onClick={() => setState('idle')} disabled={state === 'doing'} style={btn(false)}>Keep</button>
                <button onClick={run} disabled={state === 'doing'} style={btn(true)}>{state === 'doing' ? 'Working…' : 'Yes, do it'}</button>
              </>
            ) : (
              <button onClick={() => setState('confirm')} disabled={!quote.canRefund && quote.amountCents > 0} style={btn(true)}>
                {quote.amountCents > 0 ? `Refund ${money(quote.amountCents, quote.currency)} and end plan` : 'End plan without refund'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
