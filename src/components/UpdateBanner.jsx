'use client';
import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/ThemeContext';
import { shouldOfferReload, VERSION_CHECK_MS } from '@/lib/appVersion';

// "The app has been updated — reload." Shown when the deployed build has moved
// on since this tab loaded (see src/lib/appVersion.js).
//
// Deliberately an offer, never an automatic reload: a tab is often mid-recording
// or mid-transcription, and reloading under the user would be worse than the
// stale code. It sits at the bottom corner and can be dismissed for this tab.
export default function UpdateBanner() {
  const { SURFACE, BORDER, MUTED, H1: TEXT, CORAL: A } = useTheme();
  const [loaded,    setLoaded]    = useState(null);
  const [latest,    setLatest]    = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        const { version } = await res.json();
        if (!live || typeof version !== 'string') return;
        setLoaded(prev => prev ?? version);   // the build this tab is running
        setLatest(version);                   // what is deployed now
      } catch {
        // Offline or a failed request says nothing about the deployed version.
      }
    };
    read();
    const id = setInterval(read, VERSION_CHECK_MS);
    // A tab left in the background for hours is the exact case this exists for:
    // check again the moment it comes back.
    const onVisible = () => { if (!document.hidden) read(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { live = false; clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  if (dismissed || !shouldOfferReload({ loaded, latest })) return null;

  return (
    <div role="status" style={{
      position: 'fixed', bottom: 16, right: 16, zIndex: 50, maxWidth: 320,
      background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12,
      boxShadow: '0 6px 24px rgba(0,0,0,0.12)', padding: '12px 14px',
    }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: TEXT, margin: '0 0 4px' }}>miru has been updated</p>
      <p style={{ fontSize: 12, color: MUTED, margin: '0 0 10px', lineHeight: 1.5 }}>
        This page is running an older version. Reload when you are not in the middle of
        a session — recording and transcription are not interrupted by waiting.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => window.location.reload()}
          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: A, color: '#fff', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
          Reload
        </button>
        <button onClick={() => setDismissed(true)}
          style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
          Later
        </button>
      </div>
    </div>
  );
}
