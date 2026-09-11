// The palette is chosen by the time of day on the user's own device — there is
// no manual light/dark switch any more. Morning is pale and cool, midday is
// saturated, and from late afternoon the app turns dark for evening sessions.
//
// Pure functions only: no React, no DOM, no clock of its own. The hour is always
// passed in, which is what makes the boundaries and the contrast of every mode
// testable.

// Derived tokens (border, nav tint, ok/err) are picked per mode rather than
// shared, because a single set cannot stay legible on both #EEF8F6 and #0C3835.
export const THEMES = {
  morning: {
    period:     'morning',
    bg:         '#EEF8F6',
    surface:    '#FFFFFF',
    text:       '#0E4F4B',
    // Darker again, and for the same reason the first adjustment was made: the
    // earlier pass aimed at a 3:1 floor, which is the threshold for LARGE text
    // and UI components. Almost every use of this token in the app is small
    // secondary text — stat captions, dates, empty states — and that needs
    // 4.5:1. Measured against the worse of the two grounds this text sits on —
    // the page background, not the card — #609894 came to 3.02:1, so those
    // labels were failing while the comment said they passed. #4C7976 reaches
    // 4.51:1 on both; the hue is unchanged.
    textMuted:  '#4C7976',
    accent:     '#299C97',
    accentDeep: '#127A76',
    glow:       'rgba(95,199,196,0.22)',
    border:     '#CDE7E3',
    navActive:  '#DDF0ED',
    ok:         '#0F7A55',
    err:        '#B3261E',
    isDark:     false,
  },
  day: {
    period:     'day',
    bg:         '#D9EDEB',
    surface:    '#FFFFFF',
    text:       '#0A3F3D',
    // 3.57:1 before — close enough to look fine and still short of the floor.
    textMuted:  '#44706D',
    accent:     '#127A76',
    accentDeep: '#0A3F3D',
    glow:       'rgba(44,166,160,0.24)',
    border:     '#B6DAD6',
    navActive:  '#C7E4E0',
    ok:         '#0F6B4C',
    err:        '#A01B14',
    isDark:     false,
  },
  // Evening is indigo, not a darkened version of the daytime teal: night has a
  // different temperature. Measured on this background, every value clears 4.5:1
  // — body text 14.85:1, muted 6.13:1, accent 6.95:1 — so nothing needed
  // adjusting the way the morning palette did.
  evening: {
    period:     'evening',
    bg:         '#141B2E',
    surface:    '#1E2740',
    text:       '#EAEFF8',
    textMuted:  '#8A9BBE',
    accent:     '#7EA8DC',
    accentDeep: '#7EA8DC',
    glow:       'rgba(126,168,220,0.20)',
    // Derived tokens follow the hue too. Left teal they would have shown as
    // green hairlines around every card on an indigo background.
    border:     '#313F63',
    navActive:  '#283555',
    // Status colours keep their meaning rather than the theme's hue: green
    // still reads as "went well", and both clear the threshold here (8.1:1
    // and 7.5:1 on the surface).
    ok:         '#6FD3A8',
    err:        '#FF9E96',
    isDark:     true,
  },
};

// 5:00–11:00 morning · 11:00–17:00 day · 17:00–5:00 evening/night.
export function periodForHour(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h)) return 'day';
  const n = ((Math.floor(h) % 24) + 24) % 24; // tolerate 25, -1, 23.9
  if (n >= 5 && n < 11) return 'morning';
  if (n >= 11 && n < 17) return 'day';
  return 'evening';
}

export function themeForHour(hour) {
  return THEMES[periodForHour(hour)];
}

export function themeForDate(date = new Date()) {
  return themeForHour(date.getHours());
}

// The same tokens as CSS custom properties, so stylesheet rules (headings,
// scrollbars, the recording screen's gradients) can follow the theme without
// every rule being duplicated three times.
export function cssVars(theme) {
  return {
    '--bg':          theme.bg,
    '--surface':     theme.surface,
    '--text':        theme.text,
    '--text-muted':  theme.textMuted,
    '--accent':      theme.accent,
    '--accent-deep': theme.accentDeep,
    '--glow':        theme.glow,
    '--border':      theme.border,
    '--nav-active':  theme.navActive,
    '--ok':          theme.ok,
    '--err':         theme.err,
  };
}

// Write the palette onto :root. Separate from the React tree so the variables
// exist for plain CSS too, and so a re-render is not needed to repaint.
export function applyTheme(theme, root) {
  const el = root || (typeof document === 'undefined' ? null : document.documentElement);
  if (!el) return theme;
  const vars = cssVars(theme);
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  el.dataset.period = theme.period;
  el.style.colorScheme = theme.isDark ? 'dark' : 'light';
  return theme;
}

// How often the clock is re-checked while a tab stays open. A session can run
// straight through a boundary — starting in daylight and ending after dark.
export const THEME_REFRESH_MS = 10 * 60 * 1000;
