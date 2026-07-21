'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase';

const AuthCtx = createContext({ supabase: null, user: null, loading: true });

export function AuthProvider({ children }) {
  const [supabase]      = useState(() => createClient());
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router   = useRouter();
  const pathname = usePathname();

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
    const pub = pathname === '/auth';
    if (!user && !pub) router.replace('/auth');
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
