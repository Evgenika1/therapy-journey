'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { themeForDate, applyTheme, THEME_REFRESH_MS } from '@/lib/timeTheme';

// The palette follows the device clock — morning, day, evening — instead of a
// manual light/dark switch. The token names below are the ones the pages have
// always consumed (BG, SURFACE, CORAL…), so every existing screen keeps working
// unchanged; only where those tokens point has changed.
function tokens(t) {
  return {
    BG:         t.bg,
    SURFACE:    t.surface,
    WHITE:      t.surface,
    BORDER:     t.border,
    H1:         t.text,
    BODY:       t.text,
    MUTED:      t.textMuted,
    SEC:        t.textMuted,
    CORAL:      t.accent,      // the app's accent; turquoise now, name kept
    ACCENT:     t.accent,
    ACCENT_DEEP:t.accentDeep,
    GLOW:       t.glow,
    NAV_ACTIVE: t.navActive,
    GREEN:      t.ok,
    ERR:        t.err,
    isDark:     t.isDark,
    period:     t.period,
  };
}

// Server render and first paint must agree, so both start from the same
// deterministic value; the real clock is read in the effect below.
const INITIAL = themeForDate(new Date(2000, 0, 1, 12));

const ThemeCtx = createContext(tokens(INITIAL));

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(INITIAL);

  useEffect(() => {
    // Read the actual hour only on the client: doing it during render would
    // make the server's HTML and the browser's first paint disagree.
    const sync = () => {
      const next = themeForDate(new Date());
      applyTheme(next, document.documentElement);
      setTheme(prev => (prev.period === next.period ? prev : next));
    };
    sync();

    // A session can run straight through a boundary — begin in daylight, end
    // after dark — so keep checking while the tab is open, and re-check on
    // return in case the machine was asleep across one.
    const id = setInterval(sync, THEME_REFRESH_MS);
    const onVisible = () => { if (!document.hidden) sync(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  return (
    <ThemeCtx.Provider value={tokens(theme)}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeCtx);
}
