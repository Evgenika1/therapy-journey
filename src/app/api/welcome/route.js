import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/supabaseServer';
import { serviceSupabase } from '@/lib/stripeServer';
import { sendEmail, welcomeEmail } from '@/lib/email';
import { FREE_TRIAL_MINUTES } from '@/lib/plans';

const WELCOME_SINCE = '2026-11-23T00:00:00Z';

// POST — send the welcome email once, after the email address is confirmed.
// Called by the Dashboard while the account has no welcome_sent mark; the mark
// lives in the user's app metadata (writable only with the service role), so
// it survives devices and cannot be reset from the browser.
export async function POST() {
  const { user } = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  if (!user.email_confirmed_at) return NextResponse.json({ sent: false, reason: 'not_confirmed' });
  if (user.app_metadata?.welcome_sent) return NextResponse.json({ sent: false, reason: 'already' });

  // Accounts from before the welcome email existed are only marked, not
  // written to: "welcome" to someone who has used Kevi for months is odd.
  const isNew = new Date(user.created_at) >= new Date(WELCOME_SINCE);

  const admin = serviceSupabase();
  // Mark first: a double call must not send two emails.
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { ...(user.app_metadata || {}), welcome_sent: new Date().toISOString() },
  });
  if (error) { console.error('[welcome] could not mark:', error.message); return NextResponse.json({ sent: false }, { status: 500 }); }

  if (!isNew) return NextResponse.json({ sent: false, reason: 'existing_account' });
  const sent = await sendEmail({ to: user.email, ...welcomeEmail({ trialMinutes: FREE_TRIAL_MINUTES }), idempotencyKey: `welcome-${user.id}` });
  return NextResponse.json({ sent });
}
