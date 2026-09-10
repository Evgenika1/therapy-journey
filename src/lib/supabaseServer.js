import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// The server half of auth, added so the API routes can know who is calling.
//
// /api/analyze, /api/chat and /api/patterns used to be anonymous: the browser
// assembled a payload, the route forwarded it to Claude with the server's key,
// and nobody asked who was on the other end. That made per-account metering
// impossible, and made the route an open relay — knowing the URL was enough to
// spend the Anthropic budget.
//
// patterns/route.js recorded a reason for going around Supabase: no service-role
// key needed. That reason survives intact. This uses the caller's own session on
// the anon key, so every read is still fenced by the same row-level security as
// the browser; nothing here can see another account's data.

export function createClientFromCookies(cookieStore) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        // Route handlers do not refresh the session cookie — that is the
        // middleware's job in an app that has one. Swallowing the write keeps
        // @supabase/ssr from throwing on a read-only cookie store.
        setAll: () => {},
      },
    },
  );
}

// Returns { supabase, user } — user is null when the caller is not signed in.
// Every route that spends money starts here.
export async function getServerUser() {
  const supabase = createClientFromCookies(await cookies());
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) console.warn('[auth] getUser:', error.message);
  return { supabase, user: user ?? null };
}
