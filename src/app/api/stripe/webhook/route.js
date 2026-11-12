import { NextResponse } from 'next/server';
import { getStripe, serviceSupabase } from '@/lib/stripeServer';
import { subscriptionRow, shouldReplace } from '@/lib/plans';

// Stripe → subscriptions table.
//
// The event is only a nudge: whatever it carries, the subscription is fetched
// again from Stripe and that current state is written. So it does not matter
// in which order events arrive, or how often one is retried — the row always
// ends up matching Stripe.
//
// Errors answer 500 on purpose: Stripe retries a failed delivery for days, so
// a database hiccup costs a delay, not a lost payment.

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

export async function POST(req) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[stripe] webhook: STRIPE_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Webhook not configured.' }, { status: 500 });
  }

  const stripe = getStripe();
  let event;
  try {
    // The signature is over the raw bytes, so the body is read as text, never
    // parsed first.
    event = stripe.webhooks.constructEvent(await req.text(), req.headers.get('stripe-signature'), secret);
  } catch (e) {
    console.warn('[stripe] webhook: bad signature:', e?.message);
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  try {
    const obj = event.data.object;
    if (event.type === 'checkout.session.completed' && obj.mode === 'subscription' && obj.subscription) {
      await sync(stripe, obj.subscription, obj.client_reference_id || obj.metadata?.user_id);
    } else if (SUBSCRIPTION_EVENTS.has(event.type)) {
      await sync(stripe, obj.id, obj.metadata?.user_id);
    }
    return NextResponse.json({ received: true });
  } catch (e) {
    console.error('[stripe] webhook', event.type, event.id, ':', e?.message);
    return NextResponse.json({ error: 'Could not process event.' }, { status: 500 });
  }
}

async function sync(stripe, subscriptionId, userIdHint) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const admin = serviceSupabase();
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  // Which account: the id Checkout carried, or failing that, the account this
  // Stripe customer already belongs to.
  let userId = userIdHint || sub.metadata?.user_id || null;
  if (!userId) {
    const { data, error } = await admin
      .from('subscriptions').select('user_id').eq('stripe_customer_id', customer).maybeSingle();
    if (error) throw error;
    userId = data?.user_id ?? null;
  }
  if (!userId) {
    // Not ours to place — e.g. a customer made by hand in the dashboard.
    console.warn('[stripe] webhook: no account for subscription', subscriptionId);
    return;
  }

  const row = subscriptionRow(sub, userId);
  const { data: existing, error: readErr } = await admin
    .from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
  if (readErr) throw readErr;
  if (!shouldReplace(existing, row)) {
    console.log('[stripe] webhook: ignoring', sub.id, sub.status, '— account has a newer active subscription');
    return;
  }

  const { error } = await admin.from('subscriptions').upsert(row, { onConflict: 'user_id' });
  if (error) throw error;
  console.log('[stripe] webhook: account', userId, '→', row.plan, row.status);
}
