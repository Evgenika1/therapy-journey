import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/supabaseServer';
import { getStripe, appOrigin } from '@/lib/stripeServer';

// Stripe's Customer Portal: change plan, cancel, update the card, invoices.
// The customer id is read with the caller's own session — RLS returns their
// own subscription row only, so nobody can open someone else's portal.
export async function POST(req) {
  try {
    const { supabase, user } = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    const { data, error } = await supabase
      .from('subscriptions').select('stripe_customer_id').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    if (!data?.stripe_customer_id) {
      return NextResponse.json({ error: 'No subscription to manage yet.' }, { status: 400 });
    }

    const portal = await getStripe().billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${appOrigin(req)}/billing`,
    });
    return NextResponse.json({ url: portal.url });
  } catch (e) {
    console.error('[stripe] portal:', e?.message);
    return NextResponse.json({ error: 'Could not open subscription management. Please try again.' }, { status: 500 });
  }
}
