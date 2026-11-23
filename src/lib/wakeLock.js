// Keeps the screen on while a session is being recorded.
//
// A long session with nobody touching the computer is the normal case, and
// when the Mac dims, locks or sleeps the browser can end a shared tab's audio
// (a live run stopped at 33 minutes). The Screen Wake Lock API asks the OS to
// keep the display awake; it is dropped whenever the page is hidden, so it is
// asked for again when the page comes back. Unsupported browsers: no-op.

export function holdScreenAwake() {
  let lock = null;
  let released = false;
  const nav = typeof navigator !== 'undefined' ? navigator : null;

  const acquire = async () => {
    if (released || !nav?.wakeLock || document.visibilityState !== 'visible') return;
    try { lock = await nav.wakeLock.request('screen'); }
    catch (e) { console.warn('[Recording] wake lock refused:', e?.message); }
  };
  const onVisible = () => { if (document.visibilityState === 'visible' && (!lock || lock.released)) acquire(); };

  acquire();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);

  return () => {
    released = true;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    lock?.release?.().catch(() => {});
    lock = null;
  };
}
