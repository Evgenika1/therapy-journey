'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';

const NAV = [
  { href: '/',             label: 'Dashboard'    },
  { href: '/sessions',     label: 'Sessions'     },
  { href: '/patterns',     label: 'Patterns'     },
  { href: '/homework',     label: 'Homework'     },
  { href: '/ai-chat',      label: 'AI Chat'      },
  { href: '/diary',        label: 'Diary'        },
  { href: '/journals',     label: 'Journals'     },
  { href: '/emotions',     label: 'Emotions'     },
];

export default function AppLayout({ children }) {
  // ACCENT_DEEP, GLOW and isDark went with the eye SVG that was the only thing
  // reading them; a destructured name nothing uses misstates what this
  // component depends on.
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL } = useTheme();
  const { supabase, user } = useAuth();
  const pathname = usePathname();

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: BG, fontFamily: '"Plus Jakarta Sans", sans-serif', overflow: 'hidden' }}>
      {/* Sidebar */}
      <nav className="app-nav" style={{ background: SURFACE, borderRight: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Logo. Just the word, set in italic serif — no eye, no halo, no
            plaque behind it. It takes the text colour, so it darkens in the
            morning and lightens for the evening palette along with everything
            else, and it is the one link home from every other screen. */}
        <div style={{ padding: '20px 20px 16px', display: 'flex', alignItems: 'center' }}>
          <Link href="/" aria-label="Miru — go to Dashboard"
            style={{ textDecoration: 'none', display: 'inline-block', cursor: 'pointer', transition: 'opacity 0.12s' }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.72'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}>
            <span style={{
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
              fontSize: 34,
              fontWeight: 400,
              // Italic serif at this size sets loose; a touch negative brings
              // the four letters back together as one mark.
              letterSpacing: '-0.015em',
              lineHeight: 1.1,
              color: TEXT,
              display: 'block',
            }}>
              miru
            </span>
          </Link>
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
