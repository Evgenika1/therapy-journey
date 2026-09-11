// The palette is picked from the device clock, so nobody ever sees a "wrong"
// mode they can correct by hand — which makes the boundaries and the legibility
// of all three modes worth pinning down rather than eyeballing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  THEMES, periodForHour, themeForHour, themeForDate, cssVars, applyTheme, THEME_REFRESH_MS,
} from '../src/lib/timeTheme.js';

// ── WCAG relative luminance / contrast ratio ─────────────────────────────────

function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  const m = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16));
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// ── boundaries ───────────────────────────────────────────────────────────────

test('the day is split at 5:00, 11:00 and 17:00', () => {
  assert.equal(periodForHour(5),  'morning');
  assert.equal(periodForHour(10), 'morning');
  assert.equal(periodForHour(11), 'day');
  assert.equal(periodForHour(16), 'day');
  assert.equal(periodForHour(17), 'evening');
  assert.equal(periodForHour(23), 'evening');
  assert.equal(periodForHour(0),  'evening');
  assert.equal(periodForHour(4),  'evening');
});

test('every hour of the day maps to exactly one mode', () => {
  const seen = {};
  for (let h = 0; h < 24; h++) {
    const p = periodForHour(h);
    assert.ok(THEMES[p], `hour ${h} produced unknown period ${p}`);
    seen[p] = (seen[p] || 0) + 1;
  }
  assert.deepEqual(seen, { morning: 6, day: 6, evening: 12 });
});

test('a nonsense hour falls back instead of crashing the app', () => {
  assert.equal(periodForHour(NaN), 'day');
  assert.equal(periodForHour(undefined), 'day');
  assert.equal(periodForHour(25), 'evening');  // 25 wraps to 01:00
  assert.equal(periodForHour(-1), 'evening');  // -1 → 23:00
  assert.equal(periodForHour(11.9), 'day');    // fractional hours floor
});

test('themeForDate reads the local hour', () => {
  const evening = new Date(); evening.setHours(21, 0, 0, 0);
  const morning = new Date(); morning.setHours(8, 0, 0, 0);
  assert.equal(themeForDate(evening).period, 'evening');
  assert.equal(themeForDate(morning).period, 'morning');
});

// ── contrast: the point of the whole exercise ────────────────────────────────

test('body text is legible against both background and surface in all modes', () => {
  // WCAG AA for body text is 4.5:1.
  for (const [name, t] of Object.entries(THEMES)) {
    const onBg = contrast(t.text, t.bg);
    const onSurface = contrast(t.text, t.surface);
    assert.ok(onBg >= 4.5, `${name}: text on bg is ${onBg.toFixed(2)}:1, below 4.5`);
    assert.ok(onSurface >= 4.5, `${name}: text on surface is ${onSurface.toFixed(2)}:1, below 4.5`);
  }
});

test('muted text clears the large-text threshold in all modes', () => {
  // textMuted is only ever used for secondary lines — timestamps, counts,
  // section labels. 3:1 is the WCAG AA floor for large/secondary text; this
  // asserts the real measured values so a palette tweak cannot quietly push
  // one of them into unreadable territory.
  const measured = {};
  for (const [name, t] of Object.entries(THEMES)) {
    measured[name] = {
      onBg: +contrast(t.textMuted, t.bg).toFixed(2),
      onSurface: +contrast(t.textMuted, t.surface).toFixed(2),
    };
  }
  for (const [name, m] of Object.entries(measured)) {
    assert.ok(m.onBg >= 3, `${name}: muted on bg is ${m.onBg}:1, below 3`);
    assert.ok(m.onSurface >= 3, `${name}: muted on surface is ${m.onSurface}:1, below 3`);
  }
});

test('the accent is legible as text and as a button background', () => {
  for (const [name, t] of Object.entries(THEMES)) {
    // Accent used as a text/label colour on the surface.
    const label = contrast(t.accent, t.surface);
    assert.ok(label >= 3, `${name}: accent label on surface is ${label.toFixed(2)}:1, below 3`);
    // accentDeep is the filled-button colour; its label is white in light modes
    // and the dark background in the evening mode.
    const buttonText = t.isDark ? t.bg : '#FFFFFF';
    const onButton = contrast(buttonText, t.accentDeep);
    assert.ok(onButton >= 4.5,
      `${name}: button text on accentDeep is ${onButton.toFixed(2)}:1, below 4.5`);
  }
});

test('borders are visible against both the background and the surface', () => {
  for (const [name, t] of Object.entries(THEMES)) {
    assert.ok(contrast(t.border, t.surface) >= 1.15, `${name}: border invisible on surface`);
    assert.ok(contrast(t.border, t.bg) >= 1.05, `${name}: border invisible on bg`);
  }
});

test('status colours stay readable on their own mode', () => {
  for (const [name, t] of Object.entries(THEMES)) {
    for (const key of ['ok', 'err']) {
      const c = contrast(t[key], t.surface);
      assert.ok(c >= 3, `${name}: ${key} on surface is ${c.toFixed(2)}:1, below 3`);
    }
  }
});

test('the evening mode is actually dark and the daytime ones are not', () => {
  assert.equal(THEMES.evening.isDark, true);
  assert.equal(THEMES.morning.isDark, false);
  assert.equal(THEMES.day.isDark, false);
  assert.ok(luminance(THEMES.evening.bg) < 0.1, 'evening background should be dark');
  assert.ok(luminance(THEMES.morning.bg) > 0.7, 'morning background should be pale');
});

// ── the palette the spec asked for, unchanged ────────────────────────────────

test('the specified colours are carried through exactly', () => {
  assert.equal(THEMES.morning.bg, '#EEF8F6');
  assert.equal(THEMES.morning.accentDeep, '#127A76');
  assert.equal(THEMES.day.bg, '#D9EDEB');
  assert.equal(THEMES.day.text, '#0A3F3D');
  assert.equal(THEMES.evening.bg, '#141B2E');
  assert.equal(THEMES.evening.surface, '#1E2740');
  assert.equal(THEMES.evening.text, '#EAEFF8');
  assert.equal(THEMES.evening.accent, '#7EA8DC');
  assert.equal(THEMES.evening.glow, 'rgba(126,168,220,0.20)');
});

test('muted text clears the small-text contrast floor in every theme', () => {
  // This used to pin hexes against a 3:1 floor. 3:1 is the threshold for LARGE
  // text and UI components; nearly every use of textMuted in the app is small
  // secondary text — stat captions, dates, empty states, timestamps — and that
  // needs 4.5:1. The morning value measured 3.27:1 against the surface, so
  // those labels were failing while the test said they passed.
  //
  // Asserting the ratio rather than the hex is the point: it is the property
  // that matters, and it keeps holding if the hue is ever retuned.
  for (const [name, t] of Object.entries(THEMES)) {
    for (const behind of ['bg', 'surface']) {
      const ratio = contrast(t.textMuted, t[behind]);
      assert.ok(ratio >= 4.5,
        `${name} textMuted on ${behind}: ${ratio.toFixed(2)}:1 is under the 4.5:1 small text needs`);
    }
  }
});

test('the accent stays usable for fills, whatever it measures as text', () => {
  // The accent is a fill colour — buttons, ticks, the checkbox — where 3:1 is
  // the right floor. It is deliberately NOT held to 4.5:1: where it carries
  // small text instead, the call site uses accentDeep. See the two dashboard
  // links in src/app/page.js.
  for (const [name, t] of Object.entries(THEMES)) {
    const ratio = contrast(t.accent, t.surface);
    assert.ok(ratio >= 3, `${name} accent on surface: ${ratio.toFixed(2)}:1`);
  }
});

test('accentDeep can carry small text on every background', () => {
  for (const [name, t] of Object.entries(THEMES)) {
    const ratio = contrast(t.accentDeep, t.surface);
    assert.ok(ratio >= 4.5, `${name} accentDeep on surface: ${ratio.toFixed(2)}:1`);
  }
});

// ── CSS variables ────────────────────────────────────────────────────────────

test('every token is exported as a CSS variable', () => {
  const vars = cssVars(THEMES.evening);
  assert.equal(vars['--bg'], '#141B2E');
  assert.equal(vars['--accent-deep'], '#7EA8DC');
  assert.equal(vars['--glow'], 'rgba(126,168,220,0.20)');
  for (const v of Object.values(vars)) assert.ok(v, 'no empty CSS variable');
});

test('applyTheme writes the variables and marks the period', () => {
  const set = {};
  const fakeRoot = { style: { setProperty: (k, v) => { set[k] = v; } }, dataset: {} };
  applyTheme(THEMES.morning, fakeRoot);
  assert.equal(set['--bg'], '#EEF8F6');
  assert.equal(set['--accent'], '#299C97');
  assert.equal(fakeRoot.dataset.period, 'morning');
  assert.equal(fakeRoot.style.colorScheme, 'light');

  applyTheme(THEMES.evening, fakeRoot);
  assert.equal(fakeRoot.dataset.period, 'evening');
  assert.equal(fakeRoot.style.colorScheme, 'dark');
});

test('applyTheme is a no-op without a DOM instead of throwing', () => {
  assert.doesNotThrow(() => applyTheme(THEMES.day, null));
});

test('the clock is re-checked often enough to catch a boundary mid-session', () => {
  assert.ok(THEME_REFRESH_MS <= 15 * 60 * 1000);
  assert.ok(THEME_REFRESH_MS >= 60 * 1000);
});
