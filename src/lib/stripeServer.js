import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Server-only: the Stripe secret key and the Supabase service-role key. Never
// import this from a page or component — both keys would end up in the bundle.

let stripe = null;
export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set.');
  stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripe;
}

// The one place in the app that writes past row-level security. Used for the
// subscriptions table only, which has no write policy for anyone else: the
// webhook has no user session, and a user must not be able to write their own
// plan.
export function serviceSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Where Stripe sends the browser back to. The request's own origin, so
// localhost, a preview deployment and kevi.online each return to themselves.
export function appOrigin(req) {
  return process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
}

// Off in test mode. Turning on Stripe Tax before going live is then one
// environment variable — the prices are already tax-inclusive.
export function automaticTax() {
  return process.env.STRIPE_AUTOMATIC_TAX === 'on';
}
