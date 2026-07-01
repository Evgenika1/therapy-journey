'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { useTheme } from '@/lib/ThemeContext';

export default function AuthPage() {
  const router     = useRouter();
  const [supabase] = useState(() => createClient());
  const { BG, WHITE, CORAL, H1, BODY, SEC, BORDER, ERR, isDark } = useTheme();

  const [mode,        setMode]        = useState('signin');
  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [confirm,     setConfirm]     = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newConfirm,  setNewConfirm]  = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [info,        setInfo]        = useState('');

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '13px 16px',
    background: isDark ? '#1e1e1e' : BG,
    border: `1px solid ${BORDER}`,
    borderRadius: 12, fontSize: 14, color: H1, outline: 'none',
  };

  const btnStyle = (disabled) => ({
    width: '100%', padding: '13px', marginTop: 16, borderRadius: 12,
    border: 'none', background: disabled ? CORAL + '60' : CORAL,
    color: '#fff', fontSize: 14, fontWeight: 500,
    cursor: disabled ? 'default' : 'pointer',
  });

  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('reset-password');
        setError(''); setInfo('');
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  function switchMode(m) {
    setMode(m); setError(''); setInfo(''); setPassword(''); setConfirm('');
  }

  async function handleSignIn(e) {
    e.preventDefault();
    setError(''); setInfo('');
    if (!supabase) { setError('Supabase is not configured.'); return; }
    if (!email.trim())  { setError('Please enter your email.'); return; }
    if (!password)      { setError('Please enter your password.'); return; }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(), password,
      });
      if (err) {
        if (err.message.toLowerCase().includes('email not confirmed')) {
          throw new Error('Email not confirmed yet — check your inbox for a confirmation link.');
        }
        throw err;
      }
      router.push('/');
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  async function handleSignUp(e) {
    e.preventDefault();
    setError(''); setInfo('');
    if (!supabase)            { setError('Supabase is not configured.'); return; }
    if (!email.trim())        { setError('Please enter your email.'); return; }
    if (!password)            { setError('Please enter a password.'); return; }
    if (password.length < 6)  { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(), password,
      });
      if (err) {
        if (err.message?.toLowerCase().includes('sending confirmation email') ||
            err.message?.toLowerCase().includes('unexpected_failure')) {
          throw new Error('Account created but confirmation email failed to send. Please disable "Confirm email" in your Supabase Auth settings, then try again.');
        }
        throw err;
      }
      if (data.session) {
        router.push('/');
      } else {
        setInfo('confirm-sent');
        setLoading(false);
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    setError(''); setInfo('');
    if (!email.trim()) { setError('Please enter your email address.'); return; }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: typeof window !== 'undefined' ? window.location.origin + '/auth' : '/auth' }
      );
      if (err) throw err;
      setInfo('reset-sent');
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    setError('');
    if (!newPassword)               { setError('Please enter a new password.'); return; }
    if (newPassword.length < 6)     { setError('Password must be at least 6 characters.'); return; }
    if (newPassword !== newConfirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: newPassword });
      if (err) throw err;
      setInfo('password-updated');
      setLoading(false);
      setTimeout(() => router.push('/'), 2000);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  const shell = (content) => (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420, background: WHITE, borderRadius: 24, padding: '40px 36px', border: `1px solid ${BORDER}` }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <Link href="/" style={{ textDecoration: 'none' }}>
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 28, fontFamily: "'Shippori Mincho', serif", fontWeight: 400, color: H1, letterSpacing: '0.04em' }}>見る</span>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 400, color: H1, margin: '0 0 4px', fontFamily: "'Shippori Mincho', serif", letterSpacing: '0.04em' }}>Miru</h1>
          </Link>
          <p style={{ fontSize: 12, color: SEC, margin: 0 }}>Your private therapy companion</p>
        </div>
        {content}
      </div>
    </div>
  );

  if (info === 'confirm-sent') return shell(
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>📬</div>
      <h2 style={{ fontSize: 18, fontWeight: 500, color: H1, margin: '0 0 8px' }}>Check your email</h2>
      <p style={{ fontSize: 13, color: SEC, lineHeight: 1.6, margin: '0 0 24px' }}>
        We sent a confirmation link to <strong style={{ color: BODY }}>{email}</strong>.<br />
        Click the link to activate your account, then sign in.
      </p>
      <button onClick={() => { setInfo(''); switchMode('signin'); }} style={{ ...btnStyle(false), marginTop: 0 }}>
        Back to Sign In
      </button>
    </div>
  );

  if (info === 'reset-sent') return shell(
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 36, marginBottom: 16 }}>📩</div>
      <h2 style={{ fontSize: 18, fontWeight: 500, color: H1, margin: '0 0 12px' }}>Password reset sent</h2>
      <p style={{ fontSize: 14, color: BODY, lineHeight: 1.7, margin: '0 0 24px' }}>
        We sent a link to <strong style={{ color: H1 }}>{email}</strong>. Check your inbox.
      </p>
      <button onClick={() => { setInfo(''); setMode('signin'); }} style={{ ...btnStyle(false), marginTop: 0 }}>
        Back to Sign In
      </button>
    </div>
  );

  if (mode === 'reset-password') return shell(
    info === 'password-updated' ? (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
        <h2 style={{ fontSize: 18, fontWeight: 500, color: H1, margin: '0 0 8px' }}>Password updated</h2>
        <p style={{ fontSize: 13, color: SEC }}>Redirecting you to the app…</p>
      </div>
    ) : (
      <>
        <h2 style={{ fontSize: 17, fontWeight: 500, color: H1, margin: '0 0 20px', textAlign: 'center' }}>Set new password</h2>
        <form onSubmit={handleResetPassword}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
              placeholder="New password (min 6 characters)" autoFocus autoComplete="new-password" style={inputStyle} />
            <input type="password" value={newConfirm} onChange={e => setNewConfirm(e.target.value)}
              placeholder="Confirm new password" autoComplete="new-password" style={inputStyle} />
          </div>
          {error && <p style={{ fontSize: 12, color: ERR, margin: '10px 0 0' }}>{error}</p>}
          <button type="submit" disabled={loading} style={btnStyle(loading)}>
            {loading ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </>
    )
  );

  if (mode === 'forgot') return shell(
    <>
      <h2 style={{ fontSize: 17, fontWeight: 500, color: H1, margin: '0 0 8px', textAlign: 'center' }}>Reset your password</h2>
      <p style={{ fontSize: 13, color: SEC, margin: '0 0 20px', textAlign: 'center', lineHeight: 1.6 }}>
        Enter your email and we'll send you a reset link.
      </p>
      <form onSubmit={handleForgot}>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com" autoFocus autoComplete="email" style={inputStyle} />
        {error && <p style={{ fontSize: 12, color: ERR, margin: '10px 0 0' }}>{error}</p>}
        <button type="submit" disabled={loading} style={btnStyle(loading)}>
          {loading ? 'Sending…' : 'Send Reset Link'}
        </button>
      </form>
      <button onClick={() => switchMode('signin')}
        style={{ width: '100%', marginTop: 12, padding: '10px', background: 'none', border: 'none', color: SEC, fontSize: 13, cursor: 'pointer' }}>
        ← Back to Sign In
      </button>
    </>
  );

  return shell(
    <>
      <div style={{ display: 'flex', background: BG, borderRadius: 12, padding: 4, marginBottom: 28, border: `0.5px solid ${BORDER}` }}>
        {[['signin', 'Sign In'], ['signup', 'Create Account']].map(([m, label]) => (
          <button key={m} onClick={() => switchMode(m)} style={{
            flex: 1, padding: '9px 0', borderRadius: 8, border: 'none',
            background: mode === m ? WHITE : 'transparent',
            color: mode === m ? H1 : SEC,
            fontSize: 13, fontWeight: mode === m ? 500 : 400, cursor: 'pointer',
            transition: 'all 0.15s',
          }}>{label}</button>
        ))}
      </div>

      <form onSubmit={mode === 'signin' ? handleSignIn : handleSignUp}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com" autoFocus autoComplete="email" style={inputStyle} />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder={mode === 'signup' ? 'Password (min 6 characters)' : 'Password'}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} style={inputStyle} />
          {mode === 'signup' && (
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Confirm password" autoComplete="new-password" style={inputStyle} />
          )}
        </div>
        {error && <p style={{ fontSize: 12, color: ERR, margin: '10px 0 0' }}>{error}</p>}
        <button type="submit" disabled={loading} style={btnStyle(loading)}>
          {loading
            ? (mode === 'signin' ? 'Signing in…' : 'Creating account…')
            : (mode === 'signin' ? 'Sign In' : 'Create Account')}
        </button>
      </form>

      {mode === 'signin' && (
        <button onClick={() => switchMode('forgot')}
          style={{ width: '100%', marginTop: 10, padding: '8px', background: 'none', border: 'none', color: SEC, fontSize: 12, cursor: 'pointer' }}>
          Forgot password?
        </button>
      )}

      <p style={{ fontSize: 11, color: SEC, marginTop: 20, textAlign: 'center', lineHeight: 1.6 }}>
        🔒 Your data is stored securely.
      </p>
    </>
  );
}
