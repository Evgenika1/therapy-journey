import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/supabaseServer';
import { getStripe, serviceSupabase, appOrigin, automaticTax } from '@/lib/stripeServer';
import { isPlan, priceIdFor, subscriptionGrants } from '@/lib/plans';

// Start a subscription: a Stripe Checkout Session for one plan.
//
// The body names a plan, never a price — the price is looked up here, so a
// request cannot name some other price in the Stripe account. An account that
// already has a running subscription is sent to the Customer Portal instead,
// where changing plan replaces it rather than adding a second one.
export async function POST(req) {
  try {
    const { user } = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    let body;
    try { body = await req.json(); } catch { body = null; }
    const plan = body?.plan;
    if (!isPlan(plan)) return NextResponse.json({ error: 'Unknown plan.' }, { status: 400 });
    const price = priceIdFor(plan);
    if (!price) return NextResponse.json({ error: `No Stripe price configured for ${plan}.` }, { status: 500 });

    const stripe = getStripe();
    const admin = serviceSupabase();
    const origin = appOrigin(req);

    const { data: existing, error: readErr } = await admin
      .from('subscriptions').select('*').eq('user_id', user.id).maybeSingle();
    if (readErr) throw readErr;

    if (existing?.stripe_customer_id && subscriptionGrants(existing)) {
      const portal = await stripe.billingPortal.sessions.create({
        customer: existing.stripe_customer_id,
        return_url: `${origin}/billing`,
      });
      return NextResponse.json({ url: portal.url, portal: true });
    }

    // One Stripe customer per account, created on the first checkout and kept
    // for every later one, so payment methods and invoices stay together.
    let customer = existing?.stripe_customer_id;
    if (!customer) {
      const created = await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } });
      customer = created.id;
      const { error: insErr } = await admin
        .from('subscriptions')
        .insert({ user_id: user.id, stripe_customer_id: customer, status: 'incomplete' });
      if (insErr) throw insErr;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      // The webhook finds the account from either of these.
      metadata: { user_id: user.id, plan },
      subscription_data: { metadata: { user_id: user.id } },
      success_url: `${origin}/billing?checkout=success`,
      cancel_url: `${origin}/billing?checkout=cancel`,
      ...(automaticTax() ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto' } } : {}),
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('[stripe] checkout:', e?.message);
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 });
  }
}
