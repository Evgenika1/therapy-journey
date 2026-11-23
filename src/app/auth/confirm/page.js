'use client';
import { useEffect, useRef, useState } from 'react';
import { passwordProblem } from '@/lib/passwordPolicy';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { parseAuthLink, EXPIRED_MESSAGE } from '@/lib/authLink';

// Where links from our auth emails land: confirm signup, reset password, magic
// link, change email. See src/lib/authLink.js for why the templates send a
// token_hash here rather than using Supabase's own /verify link.
//
// A recovery link signs the person in and then asks for a new password on this
// page. It used to land on /auth, where AuthProvider sends any signed-in visitor
// straight to the dashboard — so the new-password form never showed.

export default function ConfirmPage() {
  const router = useRouter();
  const { supabase } = useAuth();
  const { BG, WHITE, CORAL, H1, BODY, SEC, BORDER, ERR, isDark } = useTheme();

  // working | set-password | password-updated | email-changed | error
  const [stage, setStage] = useState('working');
  const [linkType, setLinkType] = useState(null);
  const [message, setMessage] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newConfirm, setNewConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  // A token works once. React runs effects twice in development; the second
  // verify would fail and show "expired" over a link that just worked.
  const started = useRef(false);

  useEffect(() => {
    if (!supabase || started.current) return;
    started.current = true;

    const link = parseAuthLink(window.location.search, window.location.hash);
    setLinkType(link.type ?? null);
    const fail = (msg) => { setMessage(msg); setStage('error'); };
    const arrived = (type) => {
      // The token is spent; keep it out of the address bar and history.
      window.history.replaceState(null, '', '/auth/confirm');
      if (type === 'recovery') setStage('set-password');
      else if (type === 'email_change') setStage('email-changed');
      else router.replace('/');
    };

    (async () => {
      if (link.kind === 'error') {
        return fail(link.expired ? EXPIRED_MESSAGE : 'This link could not be used. Please request a new one.');
      }
      if (link.kind === 'token') {
        const { error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
        if (error) return fail(EXPIRED_MESSAGE);
        return arrived(link.type);
      }
      if (link.kind === 'code') {
        // An older email: the code only works in the browser that asked for it.
        let recovery = false;
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
          if (event === 'PASSWORD_RECOVERY') recovery = true;
        });
        const { error } = await supabase.auth.exchangeCodeForSession(link.code);
        subscription.unsubscribe();
        if (error) return fail(`${EXPIRED_MESSAGE} If you asked for it on another device, open it there or request a new one here.`);
        return arrived(recovery ? 'recovery' : link.type);
      }
      router.replace('/');
    })();
  }, [supabase, router]);

  async function savePassword(e) {
    e.preventDefault();
    setFormError('');
    if (!newPassword)               { setFormError('Please enter a new password.'); return; }
    if (passwordProblem(newPassword)) { setFormError(passwordProblem(newPassword)); return; }
    if (newPassword !== newConfirm) { setFormError('Passwords do not match.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (error) { setFormError(error.message); return; }
    setStage('password-updated');
    setTimeout(() => router.replace('/'), 2000);
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '13px 16px',
    background: isDark ? '#1e1e1e' : BG, border: `1px solid ${BORDER}`,
    borderRadius: 12, fontSize: 14, color: H1, outline: 'none',
  };
  const btnStyle = (disabled) => ({
    display: 'block', width: '100%', boxSizing: 'border-box', padding: '13px', marginTop: 16, borderRadius: 12,
    border: 'none', background: disabled ? CORAL + '60' : CORAL, color: '#fff',
    fontSize: 14, fontWeight: 500, textAlign: 'center', textDecoration: 'none',
    // A Link styled as a button: give it the buttons' face, not the body serif.
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    cursor: disabled ? 'default' : 'pointer',
  });
  const title = (text) => <h2 style={{ fontSize: 18, fontWeight: 500, color: H1, margin: '0 0 10px', textAlign: 'center' }}>{text}</h2>;
  const note = (text) => <p style={{ fontSize: 13, color: SEC, lineHeight: 1.6, margin: 0, textAlign: 'center' }}>{text}</p>;

  let body;
  if (stage === 'working') {
    body = note('Checking your link…');
  } else if (stage === 'error') {
    const again = linkType === 'recovery' ? '/auth?mode=forgot' : '/auth';
    body = <>
      {title('Link expired')}
      <p style={{ fontSize: 13, color: BODY, lineHeight: 1.6, margin: 0, textAlign: 'center' }}>{message}</p>
      <Link href={again} style={btnStyle(false)}>
        {linkType === 'recovery' ? 'Send a new reset link' : 'Back to Sign In'}
      </Link>
    </>;
  } else if (stage === 'email-changed') {
    body = <>
      {title('Email confirmed')}
      {note('Your new email address is confirmed.')}
      <Link href="/" style={btnStyle(false)}>Go to Kevi</Link>
    </>;
  } else if (stage === 'password-updated') {
    body = <>
      {title('Password updated')}
      {note('Taking you to Kevi…')}
    </>;
  } else {
    body = <>
      {title('Set a new password')}
      <form onSubmit={savePassword}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
          <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
            placeholder="New password (min 10 characters)" autoFocus autoComplete="new-password" style={inputStyle} />
          <input type="password" value={newConfirm} onChange={e => setNewConfirm(e.target.value)}
            placeholder="Confirm new password" autoComplete="new-password" style={inputStyle} />
        </div>
        {formError && <p style={{ fontSize: 12, color: ERR, margin: '10px 0 0' }}>{formError}</p>}
        <button type="submit" disabled={busy} style={btnStyle(busy)}>
          {busy ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </>;
  }

  return (
    <div className="auth-link-shell" style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420, boxSizing: 'border-box', background: WHITE, borderRadius: 24, padding: '40px 36px', border: `1px solid ${BORDER}` }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.1, color: H1, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>kevi</span>
        </div>
        {body}
      </div>
    </div>
  );
}
