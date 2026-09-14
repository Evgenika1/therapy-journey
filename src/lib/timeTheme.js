// The palette follows the sun on the user's own day — there is no manual
// light/dark switch. Morning is pale and cool, midday is saturated, the two
// hours before sunset turn lavender, and the app only goes dark once the sun
// is down: soft indigo at dusk, deep indigo at night.
//
// It used to switch to dark at a fixed 17:00, which in September meant two and
// a half hours of night palette in full daylight, and in June over four.
//
// Pure functions only: no React, no DOM, no clock of its own. The date or hour
// is always passed in, which is what makes the boundaries and the contrast of
// every mode testable.

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
  // The two hours before sunset. Lavender rather than a dimmed teal: the light
  // is already cooling towards the indigo that follows, so the step to dusk is
  // a change of depth, not of hue. Chosen from three options in a preview.
  // Every value clears 4.5:1 on both grounds.
  afternoon: {
    period:     'afternoon',
    bg:         '#E2E2EE',
    surface:    '#F8F8FC',
    text:       '#232A45',
    textMuted:  '#555B78',
    accent:     '#4658A0',
    accentDeep: '#3A4A8C',
    glow:       'rgba(120,130,200,0.20)',
    border:     '#C9CADD',
    navActive:  '#D6D7E8',
    ok:         '#2C6B48',
    err:        '#A3301F',
    isDark:     false,
  },
  // From sunset for an hour and a half: the first dark palette, lighter than
  // night, with the warm accent of the afterglow.
  dusk: {
    period:     'dusk',
    bg:         '#2B3246',
    surface:    '#363F57',
    text:       '#F0EEF3',
    textMuted:  '#AEB3C8',
    accent:     '#EDB88F',
    accentDeep: '#EDB88F',
    glow:       'rgba(237,184,143,0.18)',
    border:     '#4A5470',
    navActive:  '#404A64',
    ok:         '#86D9B2',
    err:        '#FFA9A0',
    isDark:     true,
  },
  // Night is indigo, not a darkened version of the daytime teal: night has a
  // different temperature. Measured on this background, every value clears 4.5:1
  // — body text 14.85:1, muted 6.13:1, accent 6.95:1 — so nothing needed
  // adjusting the way the morning palette did.
  night: {
    period:     'night',
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

// ── The sun ──────────────────────────────────────────────────────────────────
//
// Sunrise and sunset are estimated, not looked up: asking a therapy journal's
// user for their location to pick colours is not a trade worth making. The
// estimate assumes a latitude of 50°N (Central Europe) and that solar noon sits
// at 12:00 standard time, so it can be half an hour out — further for someone
// far north or south, or at the edge of a wide timezone. For a colour change
// that is close enough; for anything that must be exact it is not.

export const REFERENCE_LATITUDE = 50;

const RAD = Math.PI / 180;

// Local clock hours (e.g. 19.5 for 19:30) of sunrise and sunset on a day of the
// year, given how many hours the clock is shifted for summer time.
export function sunTimesFor(dayOfYear, summerShiftHours = 0) {
  const n = Number(dayOfYear);
  const phi = REFERENCE_LATITUDE * RAD;
  const decl = -23.44 * RAD * Math.cos((2 * Math.PI / 365) * (n + 10));
  // -0.833° puts sunrise and sunset where the sun's upper edge meets the
  // horizon, allowing for refraction, which is when it looks up or down.
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(decl))
             / (Math.cos(phi) * Math.cos(decl));
  const halfDay = Math.acos(Math.min(1, Math.max(-1, cosH))) / RAD / 15;

  // Equation of time, in minutes: the sun runs up to ~16 minutes ahead of or
  // behind the clock over the year.
  const b = (2 * Math.PI / 364) * (n - 81);
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);

  const noon = 12 + summerShiftHours - eot / 60;
  return { sunrise: noon - halfDay, sunset: noon + halfDay };
}

// The same, read from a Date in the device's own timezone. Summer time is the
// difference between the offset on that date and the smaller of the January
// and July offsets, which is standard time in either hemisphere.
export function sunTimes(date = new Date()) {
  const y = date.getFullYear();
  const dayOfYear = Math.round((new Date(y, date.getMonth(), date.getDate()) - new Date(y, 0, 0)) / 86400000);
  const offset = d => -d.getTimezoneOffset();
  const standard = Math.min(offset(new Date(y, 0, 1)), offset(new Date(y, 6, 1)));
  return sunTimesFor(dayOfYear, (offset(date) - standard) / 60);
}

// ── Stages ───────────────────────────────────────────────────────────────────
//
//   night      until sunrise
//   morning    sunrise – 11:00
//   day        11:00 – two hours before sunset
//   afternoon  two hours before sunset – sunset
//   dusk       sunset – an hour and a half after
//   night      after that
//
// At 50°N sunrise is always before 11:00 and sunset always more than two hours
// after it, so the stages never overlap; the tests walk every day of the year.
export const MORNING_ENDS = 11;
export const AFTERNOON_HOURS = 2;
export const DUSK_HOURS = 1.5;

export function periodFor(hour, sun) {
  const h = Number(hour);
  const { sunrise, sunset } = sun || {};
  if (![h, sunrise, sunset].every(Number.isFinite)) return 'day';
  const t = ((h % 24) + 24) % 24;
  if (t < sunrise) return 'night';
  if (t < MORNING_ENDS) return 'morning';
  if (t < sunset - AFTERNOON_HOURS) return 'day';
  if (t < sunset) return 'afternoon';
  if (t < sunset + DUSK_HOURS) return 'dusk';
  return 'night';
}

export function themeForDate(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60;
  return THEMES[periodFor(hour, sunTimes(date))];
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
