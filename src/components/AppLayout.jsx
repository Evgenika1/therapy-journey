'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL, ACCENT_DEEP, GLOW, isDark } = useTheme();
  const { supabase, user } = useAuth();
  const pathname = usePathname();

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: BG, fontFamily: '"Plus Jakarta Sans", sans-serif', overflow: 'hidden' }}>
      {/* Sidebar */}
      <nav className="app-nav" style={{ background: SURFACE, borderRight: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Logo */}
        <div style={{ padding: '22px 20px 18px', display: 'flex', alignItems: 'center' }}>
          <span style={{
            position: 'relative',
            fontSize: 23,
            fontWeight: 400,
            letterSpacing: '0.01em',
            color: TEXT,
            fontFamily: 'var(--font-serif)',
            display: 'flex',
            alignItems: 'center',
          }}>
            {/* Halo sits behind the wordmark and is strongest in the evening,
                where --glow is heaviest. */}
            <span className="eye-glow" style={{ width: 74, height: 74, left: -8, top: '50%', transform: 'translateY(-50%)' }} />
            <span style={{ position: 'relative' }}>miru</span>
            <svg style={{ marginLeft: 5, marginBottom: 7, position: 'relative', overflow: 'visible' }}
                 width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <ellipse cx="7.5" cy="7.5" rx="7" ry="4.6" fill="none" stroke={CORAL} strokeWidth="1.1" opacity="0.55"/>
              <ellipse cx="7.5" cy="7.5" rx="4.6" ry="3.1" fill="none" stroke={CORAL} strokeWidth="1.3"/>
              <circle cx="7.5" cy="7.5" r="1.9" fill={ACCENT_DEEP}/>
              <circle cx="8.4" cy="6.6" r="0.62" fill={SURFACE} opacity="0.9"/>
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
                  borderLeft: `3px solid ${active ? CORAL : 'transparent'}`,
                  color: active ? CORAL : TEXT,
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
          {/* The light/dark toggle is gone: the palette follows the clock
              (src/lib/timeTheme.js). Deliberately unlabelled — the shift is
              meant to be felt, not announced, so nothing here names the hour. */}
          {user && (
            <>
              <div style={{ padding: '4px 20px 8px' }}>
                <p style={{ fontSize: 11, color: MUTED, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</p>
              </div>
              {/* /account exists but had no link anywhere, so changing a password
                  or deleting an account was unreachable. */}
              <Link href="/account"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 20px', paddingLeft: pathname.startsWith('/account') ? 17 : 20, textDecoration: 'none', borderLeft: `3px solid ${pathname.startsWith('/account') ? CORAL : 'transparent'}`, color: pathname.startsWith('/account') ? CORAL : TEXT, fontWeight: pathname.startsWith('/account') ? 600 : 400, fontSize: 14 }}>
                <span style={{ fontSize: 15 }}>⚙</span>
                Account
              </Link>
              <button onClick={signOut}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 20px', background: 'none', border: 'none', borderLeft: '3px solid transparent', cursor: 'pointer', color: TEXT, fontSize: 14, width: '100%' }}>
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
