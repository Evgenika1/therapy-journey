'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';

const NAV = [
  { href: '/',              label: 'Home'         },
  { href: '/sessions',      label: 'Sessions'     },
  { href: '/emotions',      label: 'Emotions'     },
  { href: '/diary',         label: 'Diary'        },
  { href: '/progress',      label: 'Progress'     },
  { href: '/next-session',  label: 'Next Session' },
  { href: '/homework',      label: 'Homework'     },
  { href: '/journals',      label: 'Journals'     },
  { href: '/ai-chat',       label: 'AI Chat'      },
  { href: '/account',       label: 'Account'      },
];

export default function AppLayout({ children }) {
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL: A, NAV_ACTIVE: ABG, isDark, toggleTheme } = useTheme();
  const { supabase, user } = useAuth();
  const pathname = usePathname();

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: BG, fontFamily: '"Plus Jakarta Sans", sans-serif', overflow: 'hidden' }}>
      {/* Sidebar */}
      <nav style={{ width: 220, flexShrink: 0, background: SURFACE, borderRight: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', padding: '24px 0', overflowY: 'auto' }}>
        {/* Logo */}
        <div style={{ padding: '0 20px 24px', borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: A, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: '"Shippori Mincho", serif', fontSize: 16, color: '#fff', fontWeight: 400 }}>見</span>
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 600, color: TEXT, margin: 0, lineHeight: 1 }}>Miru</p>
              <p style={{ fontSize: 11, color: MUTED, margin: '2px 0 0' }}>therapy journal</p>
            </div>
          </div>
        </div>

        {/* Nav links */}
        <div style={{ flex: 1, padding: '16px 10px' }}>
          {NAV.map(({ href, label, icon }) => {
            const active = pathname === href || (href !== '/' && pathname.startsWith(href));
            return (
              <Link key={href} href={href}
                style={{ display: 'block', padding: '9px 12px', borderRadius: 10, marginBottom: 2, textDecoration: 'none', background: active ? ABG : 'transparent', color: active ? A : MUTED, fontWeight: active ? 500 : 400, fontSize: 14, transition: 'background 0.12s' }}>
                {label}
              </Link>
            );
          })}
        </div>

        {/* Bottom */}
        <div style={{ padding: '16px 10px 0', borderTop: `1px solid ${BORDER}` }}>
          {user && (
            <div style={{ padding: '8px 12px 12px', marginBottom: 4 }}>
              <p style={{ fontSize: 11, color: MUTED, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</p>
            </div>
          )}
          <button onClick={toggleTheme}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: 'none', border: 'none', cursor: 'pointer', color: MUTED, fontSize: 14, width: '100%' }}>
            <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{isDark ? '☀️' : '🌙'}</span>
            {isDark ? 'Light mode' : 'Dark mode'}
          </button>
          {user && (
            <button onClick={signOut}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: 'none', border: 'none', cursor: 'pointer', color: MUTED, fontSize: 14, width: '100%', marginTop: 2 }}>
              <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>↪</span>
              Sign out
            </button>
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
