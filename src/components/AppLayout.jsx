'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';

const NAV = [
  { href: '/',             label: 'Dashboard'    },
  { href: '/sessions',     label: 'Sessions'     },
  { href: '/next-session', label: 'Next Session' },
  { href: '/homework',     label: 'Homework'     },
  { href: '/ai-chat',      label: 'AI Chat'      },
  { href: '/diary',        label: 'Diary'        },
  { href: '/journals',     label: 'Journals'     },
  { href: '/emotions',     label: 'Emotions'     },
  { href: '/progress',     label: 'Progress'     },
];

export default function AppLayout({ children }) {
  const { BG, SURFACE, BORDER, MUTED, isDark, toggleTheme } = useTheme();
  const { supabase, user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: BG, fontFamily: '"Plus Jakarta Sans", sans-serif', overflow: 'hidden' }}>
      {/* Sidebar */}
      <nav style={{ width: 220, flexShrink: 0, background: SURFACE, borderRight: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Logo */}
        <div style={{ padding: '20px 20px 16px', display: 'flex', alignItems: 'center' }}>
          <span style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: '#1C1C1C',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            display: 'flex',
            alignItems: 'center',
          }}>
            miru
            <svg style={{ marginLeft: 3, marginBottom: 8 }} width="7" height="7" viewBox="0 0 7 7" fill="none">
              <ellipse cx="3.5" cy="3.5" rx="3" ry="2.2" stroke="#E8785A" strokeWidth="1.2" fill="none"/>
              <circle cx="3.5" cy="3.5" r="1.1" fill="#E8785A"/>
            </svg>
          </span>
        </div>

        {/* Nav links */}
        <div style={{ flex: 1, padding: '8px 0' }}>
          {NAV.map(({ href, label }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link key={href} href={href}
                style={{
                  display: 'block',
                  padding: '9px 20px',
                  paddingLeft: active ? 17 : 20,
                  textDecoration: 'none',
                  borderLeft: active ? '3px solid #E8785A' : '3px solid transparent',
                  color: active ? '#E8785A' : '#1C1C1C',
                  fontWeight: active ? 600 : 400,
                  fontSize: 14,
                  transition: 'color 0.12s',
                }}>
                {label}
              </Link>
            );
          })}
        </div>

        {/* Bottom */}
        <div style={{ padding: '12px 0', borderTop: `1px solid ${BORDER}` }}>
          <button onClick={toggleTheme}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 20px', paddingLeft: 20, background: 'none', border: 'none', borderLeft: '3px solid transparent', cursor: 'pointer', color: '#1C1C1C', fontSize: 14, width: '100%' }}>
            <span style={{ fontSize: 15 }}>{isDark ? '☀️' : '🌙'}</span>
            {isDark ? 'Light mode' : 'Dark mode'}
          </button>
          {user && (
            <>
              <div style={{ padding: '4px 20px 8px' }}>
                <p style={{ fontSize: 11, color: MUTED, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</p>
              </div>
              <button onClick={signOut}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 20px', background: 'none', border: 'none', borderLeft: '3px solid transparent', cursor: 'pointer', color: '#1C1C1C', fontSize: 14, width: '100%' }}>
                <span style={{ fontSize: 15 }}>↪</span>
                Sign out
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {children}
      </main>
    </div>
  );
}
