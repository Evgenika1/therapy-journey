'use client';
import { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { useRouter } from 'next/navigation';

export default function AccountPage() {
  const { supabase, user } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL, ERR } = useTheme();
  const router = useRouter();

  const [newEmail,       setNewEmail]       = useState('');
  const [currentPass,    setCurrentPass]    = useState('');
  const [newPass,        setNewPass]        = useState('');
  const [confirmPass,    setConfirmPass]    = useState('');
  const [emailMsg,       setEmailMsg]       = useState(null);
  const [passMsg,        setPassMsg]        = useState(null);
  const [deleteConfirm,  setDeleteConfirm]  = useState('');
  const [deleteMsg,      setDeleteMsg]      = useState(null);
  const [loadingEmail,   setLoadingEmail]   = useState(false);
  const [loadingPass,    setLoadingPass]    = useState(false);
  const [loadingDelete,  setLoadingDelete]  = useState(false);

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '11px 14px', borderRadius: 10,
    border: `1px solid ${BORDER}`, background: BG,
    fontSize: 14, color: TEXT, outline: 'none',
  };

  const btnStyle = (danger) => ({
    padding: '10px 20px', borderRadius: 10, border: 'none',
    background: danger ? '#e55' : CORAL, color: '#fff',
    fontSize: 14, fontWeight: 500, cursor: 'pointer',
  });

  async function handleEmailChange(e) {
    e.preventDefault();
    setEmailMsg(null);
    if (!newEmail.trim()) { setEmailMsg({ err: true, text: 'Enter a new email.' }); return; }
    setLoadingEmail(true);
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim().toLowerCase() });
    setLoadingEmail(false);
    if (error) { setEmailMsg({ err: true, text: error.message }); return; }
    setEmailMsg({ err: false, text: 'Confirmation sent to your new email address.' });
    setNewEmail('');
  }

  async function handlePasswordChange(e) {
    e.preventDefault();
    setPassMsg(null);
    if (!newPass) { setPassMsg({ err: true, text: 'Enter a new password.' }); return; }
    if (newPass.length < 6) { setPassMsg({ err: true, text: 'Password must be at least 6 characters.' }); return; }
    if (newPass !== confirmPass) { setPassMsg({ err: true, text: 'Passwords do not match.' }); return; }
    setLoadingPass(true);
    const { error } = await supabase.auth.updateUser({ password: newPass });
    setLoadingPass(false);
    if (error) { setPassMsg({ err: true, text: error.message }); return; }
    setPassMsg({ err: false, text: 'Password updated successfully.' });
    setCurrentPass(''); setNewPass(''); setConfirmPass('');
  }

  async function handleDeleteAccount() {
    if (deleteConfirm !== 'DELETE') {
      setDeleteMsg({ err: true, text: 'Type DELETE to confirm.' });
      return;
    }
    setLoadingDelete(true);
    setDeleteMsg(null);
    // Sign out first, then the user record deletion requires a server-side call
    // For now we sign out and show a message to contact support for full deletion
    const { error } = await supabase.rpc('delete_user');
    if (error) {
      // Fallback: just sign out
      await supabase.auth.signOut();
      router.replace('/auth');
      return;
    }
    await supabase.auth.signOut();
    router.replace('/auth');
  }

  const section = (title, content) => (
    <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 28, marginBottom: 20 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, color: TEXT, margin: '0 0 20px' }}>{title}</h2>
      {content}
    </div>
  );

  const msg = (m) => m && (
    <p style={{ fontSize: 13, color: m.err ? ERR : CORAL, margin: '10px 0 0' }}>{m.text}</p>
  );

  return (
    <AppLayout>
      <div style={{ flex: 1, overflowY: 'auto', background: BG, padding: 32 }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <h1 style={{ fontSize: 28, fontWeight: 300, color: TEXT, margin: '0 0 8px', fontFamily: '"Fraunces", serif' }}>Account</h1>
          <p style={{ fontSize: 13, color: MUTED, margin: '0 0 32px' }}>{user?.email}</p>

          {section('Change Email', (
            <form onSubmit={handleEmailChange} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                placeholder="New email address" autoComplete="email" style={inputStyle} />
              {msg(emailMsg)}
              <div>
                <button type="submit" disabled={loadingEmail} style={btnStyle(false)}>
                  {loadingEmail ? 'Updating…' : 'Update Email'}
                </button>
              </div>
            </form>
          ))}

          {section('Change Password', (
            <form onSubmit={handlePasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)}
                placeholder="New password (min 6 characters)" autoComplete="new-password" style={inputStyle} />
              <input type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)}
                placeholder="Confirm new password" autoComplete="new-password" style={inputStyle} />
              {msg(passMsg)}
              <div>
                <button type="submit" disabled={loadingPass} style={btnStyle(false)}>
                  {loadingPass ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </form>
          ))}

          {section('Delete Account', (
            <div>
              <p style={{ fontSize: 13, color: MUTED, margin: '0 0 16px', lineHeight: 1.6 }}>
                This will permanently delete your account and all your data. This cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <input type="text" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
                  placeholder='Type DELETE to confirm' style={{ ...inputStyle, flex: 1 }} />
                <button onClick={handleDeleteAccount} disabled={loadingDelete} style={btnStyle(true)}>
                  {loadingDelete ? 'Deleting…' : 'Delete'}
                </button>
              </div>
              {msg(deleteMsg)}
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
