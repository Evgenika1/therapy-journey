import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/supabaseServer';
import { getStripe, serviceSupabase } from '@/lib/stripeServer';
import { PLANS, isPlan } from '@/lib/plans';
import { minutesFromCost } from '@/lib/usageQuota';
import { refundQuote } from '@/lib/refundPolicy';

// Admin-only: work out a customer's refund (GET) and carry it out (POST).
//
// Carrying it out does two things in Stripe, together: refunds the amount on
// the latest paid invoice, and cancels the subscription now rather than at the
// end of the period. A refund alone leaves the plan running (Stripe treats
// them as separate), which is how a refunded test account kept its minutes.
// The cancellation reaches the subscriptions table through the webhook.

async function requireAdmin() {
  const { supabase, user } = await getServerUser();
  if (!user) return null;
  const { data } = await supabase.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  return data ? user : null;
}

async function lookup(email) {
  const stripe = getStripe();
  const admin = serviceSupabase();
  const customers = await stripe.customers.list({ email: String(email).trim().toLowerCase(), limit: 10 });
  if (customers.data.length === 0) return { error: 'No Stripe customer with that email.' };

  const ids = customers.data.map(c => c.id);
  const { data: rows, error } = await admin.from('subscriptions').select('*').in('stripe_customer_id', ids);
  if (error) throw error;
  const row = (rows || []).find(r => r.stripe_subscription_id) ?? null;
  if (!row) return { error: 'This customer has no subscription in Kevi.' };

  const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
  const invoices = await stripe.invoices.list({ subscription: sub.id, status: 'paid', limit: 1 });
  const invoice = invoices.data[0];
  if (!invoice) return { error: 'No paid invoice on this subscription.' };
  const payments = await stripe.invoicePayments.list({ invoice: invoice.id, status: 'paid', limit: 1 });
  const paymentIntent = payments.data[0]?.payment?.payment_intent;
  const paymentIntentId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id;
  let refundedCents = 0;
  if (paymentIntentId) {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
    refundedCents = typeof pi.latest_charge === 'object' ? (pi.latest_charge?.amount_refunded ?? 0) : 0;
  }

  const paidAt = new Date((invoice.status_transitions?.paid_at ?? invoice.created) * 1000).toISOString();
  const { data: events, error: evErr } = await admin
    .from('usage_events').select('cost_usd').eq('user_id', row.user_id).gte('created_at', paidAt);
  if (evErr) throw evErr;
  const usedMinutes = minutesFromCost((events || []).reduce((s, e) => s + Number(e.cost_usd || 0), 0));

  return { stripe, sub, row, invoice, paymentIntentId, refundedCents, paidAt, usedMinutes };
}

function view(found, quote) {
  const { sub, row, invoice, paidAt } = found;
  return {
    plan: isPlan(row.plan) ? PLANS[row.plan].name : row.plan,
    status: sub.status,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end || Number.isFinite(sub.cancel_at),
    invoiceNumber: invoice.number,
    currency: invoice.currency,
    paidAt,
    canRefund: !!found.paymentIntentId,
    ...quote,
  };
}

export async function GET(req) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Admins only.' }, { status: 403 });
    const url = new URL(req.url);
    const email = url.searchParams.get('email');
    if (!email) return NextResponse.json({ error: 'Enter an email.' }, { status: 400 });
    const found = await lookup(email);
    if (found.error) return NextResponse.json({ error: found.error }, { status: 404 });
    const quote = refundQuote({
      paidCents: found.invoice.amount_paid, refundedCents: found.refundedCents,
      planMinutes: PLANS[found.row.plan]?.minutes ?? 0,
      usedMinutes: found.usedMinutes, paidAt: found.paidAt,
      ourFault: url.searchParams.get('our_fault') === '1',
    });
    return NextResponse.json(view(found, quote));
  } catch (e) {
    console.error('[admin] refund quote:', e?.message);
    return NextResponse.json({ error: 'Could not work out the refund.' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const me = await requireAdmin();
    if (!me) return NextResponse.json({ error: 'Admins only.' }, { status: 403 });
    let body; try { body = await req.json(); } catch { body = {}; }
    const found = await lookup(body.email || '');
    if (found.error) return NextResponse.json({ error: found.error }, { status: 404 });
    if (!found.paymentIntentId) return NextResponse.json({ error: 'No payment to refund on the latest invoice.' }, { status: 409 });

    // Recomputed here, never taken from the browser; the amount the admin saw
    // must still be the amount due, or nothing happens.
    const quote = refundQuote({
      paidCents: found.invoice.amount_paid, refundedCents: found.refundedCents,
      planMinutes: PLANS[found.row.plan]?.minutes ?? 0,
      usedMinutes: found.usedMinutes, paidAt: found.paidAt, ourFault: !!body.ourFault,
    });
    if (quote.amountCents !== body.amountCents) {
      return NextResponse.json({ error: 'The amount changed since you looked. Check it again.', quote: view(found, quote) }, { status: 409 });
    }

    const { stripe, sub, invoice } = found;
    let refund = null;
    if (quote.amountCents > 0) {
      refund = await stripe.refunds.create({
        payment_intent: found.paymentIntentId,
        amount: quote.amountCents,
        reason: 'requested_by_customer',
        metadata: { kevi_reason: quote.reason, used_minutes: String(Math.round(quote.usedMinutes)), by_admin: me.id },
      }, { idempotencyKey: `kevi-refund-${invoice.id}-${quote.amountCents}` });
    }
    if (sub.status !== 'canceled') {
      await stripe.subscriptions.cancel(sub.id, { invoice_now: false, prorate: false });
    }
    console.log('[admin] refund', invoice.id, quote.amountCents, quote.reason, '→ subscription ended');
    return NextResponse.json({ ok: true, refundedCents: refund?.amount ?? 0, refundStatus: refund?.status ?? null });
  } catch (e) {
    console.error('[admin] refund:', e?.message);
    return NextResponse.json({ error: `Refund failed: ${e?.message || 'unknown error'}` }, { status: 500 });
  }
}
