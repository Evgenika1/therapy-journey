'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { isPublicPath } from '@/lib/publicPaths';
import { hasAuthError } from '@/lib/authLink';

const AuthCtx = createContext({ supabase: null, user: null, loading: true });

export function AuthProvider({ children }) {
  const [supabase]      = useState(() => createClient());
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router   = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Supabase sends a refused email link (expired, already used) back to the
    // site with the error in the URL. Show it on /auth/confirm rather than
    // quietly opening the dashboard of whoever is signed in.
    const { pathname: here, search, hash } = window.location;
    if (here !== '/auth/confirm' && hasAuthError(search, hash)) {
      window.location.replace(`/auth/confirm${search}${hash}`);
    }
  }, []);

  useEffect(() => {
    // Fast initial read from cached session (no network request)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Stays in sync with sign-in / sign-out / token refresh
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (loading) return;
    // A visitor without an account who opens kevi.online sees what Kevi is
    // first (/welcome); any other app page still goes to sign-in.
    if (!user && !isPublicPath(pathname)) router.replace(pathname === '/' ? '/welcome' : '/auth');
    if (user && pathname === '/auth') router.replace('/');
  }, [user, loading, pathname, router]);

  return (
    <AuthCtx.Provider value={{ supabase, user, loading }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}
