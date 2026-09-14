// The palette follows the sun, estimated from the date and the device clock, so
// nobody ever sees a "wrong" mode they can correct by hand — which makes the
// boundaries and the legibility of all five modes worth pinning down rather
// than eyeballing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  THEMES, sunTimesFor, sunTimes, periodFor, themeForDate, cssVars, applyTheme, THEME_REFRESH_MS,
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

// ── the sun ──────────────────────────────────────────────────────────────────

// Hours as h + m/60, so a failure message reads as a clock time.
const at = (h, m = 0) => h + m / 60;

test('mid-September: sunset around half past seven, not at five', () => {
  // 14 September is day 257; Central Europe is on summer time (+1h).
  const { sunrise, sunset } = sunTimesFor(257, 1);
  assert.ok(sunset > at(18, 50) && sunset < at(19, 50), `sunset ${sunset}`);
  assert.ok(sunrise > at(6, 10) && sunrise < at(7, 10), `sunrise ${sunrise}`);
});

test('the evening moves with the seasons', () => {
  const december = sunTimesFor(355, 0);   // 21 Dec, winter time
  const june     = sunTimesFor(172, 1);   // 21 Jun, summer time
  assert.ok(december.sunset < at(16, 45), `December sunset ${december.sunset}`);
  assert.ok(june.sunset > at(21, 0), `June sunset ${june.sunset}`);
  assert.ok(december.sunrise > at(7, 45), `December sunrise ${december.sunrise}`);
  assert.ok(june.sunrise < at(5, 30), `June sunrise ${june.sunrise}`);
});

test('the summer-time shift moves the sun on the clock by exactly one hour', () => {
  const winter = sunTimesFor(257, 0);
  const summer = sunTimesFor(257, 1);
  assert.ok(Math.abs(summer.sunset - winter.sunset - 1) < 1e-9);
});

test('sunTimes reads the day of year and summer time from a Date', () => {
  const d = new Date(2026, 8, 14, 12);
  const jan = -new Date(2026, 0, 1).getTimezoneOffset();
  const jul = -new Date(2026, 6, 1).getTimezoneOffset();
  const shift = (-d.getTimezoneOffset() - Math.min(jan, jul)) / 60;
  assert.deepEqual(sunTimes(d), sunTimesFor(257, shift));
});

// ── boundaries ───────────────────────────────────────────────────────────────

const SEPT = { sunrise: at(7), sunset: at(19, 30) };

test('five stages, anchored to sunrise, 11:00 and sunset', () => {
  assert.equal(periodFor(at(6, 59), SEPT), 'night');
  assert.equal(periodFor(at(7),     SEPT), 'morning');
  assert.equal(periodFor(at(10, 59), SEPT), 'morning');
  assert.equal(periodFor(at(11),    SEPT), 'day');
  assert.equal(periodFor(at(17, 29), SEPT), 'day');
  assert.equal(periodFor(at(17, 30), SEPT), 'afternoon');  // sunset − 2h
  assert.equal(periodFor(at(19, 29), SEPT), 'afternoon');
  assert.equal(periodFor(at(19, 30), SEPT), 'dusk');       // sunset
  assert.equal(periodFor(at(20, 59), SEPT), 'dusk');
  assert.equal(periodFor(at(21),    SEPT), 'night');       // sunset + 1.5h
  assert.equal(periodFor(at(23, 59), SEPT), 'night');
  assert.equal(periodFor(0,         SEPT), 'night');
});

test('the reported bug: 17:19 on a sunny September afternoon is not dark', () => {
  // The estimated sunset that day is ~19:13, so 17:19 is already the lavender
  // stage. Which light stage it is matters less than the fact it is light: the
  // old fixed 17:00 boundary had turned the app to night by then.
  const sun = sunTimesFor(257, 1);
  const period = periodFor(at(17, 19), sun);
  assert.equal(THEMES[period].isDark, false, `17:19 gave ${period}`);
  assert.equal(THEMES[periodFor(at(19, 0), sun)].isDark, false, 'still light just before sunset');
});

test('a December evening still turns dark early', () => {
  const sun = sunTimesFor(355, 0);
  assert.equal(THEMES[periodFor(at(17, 0), sun)].isDark, true);
});

test('every quarter hour of every day of the year maps to a stage, in order', () => {
  const ORDER = ['night', 'morning', 'day', 'afternoon', 'dusk', 'night'];
  for (const shift of [0, 1]) {
    for (let day = 1; day <= 365; day++) {
      const sun = sunTimesFor(day, shift);
      let step = 0;
      for (let q = 0; q < 96; q++) {
        const p = periodFor(q / 4, sun);
        assert.ok(THEMES[p], `day ${day} ${q / 4}h: unknown period ${p}`);
        // Only ever stays or moves forward through the day's sequence.
        while (ORDER[step] !== p) {
          step++;
          assert.ok(step < ORDER.length, `day ${day} ${q / 4}h: ${p} is out of order`);
        }
      }
    }
  }
});

test('a nonsense hour or sun falls back to day instead of crashing the app', () => {
  assert.equal(periodFor(NaN, SEPT), 'day');
  assert.equal(periodFor(undefined, SEPT), 'day');
  assert.equal(periodFor(at(12), undefined), 'day');
  assert.equal(periodFor(at(12), { sunrise: NaN, sunset: NaN }), 'day');
});

test('themeForDate follows the sun for the given date', () => {
  const summerNoon = new Date(2026, 5, 21, 12, 0);
  const winterNight = new Date(2026, 11, 21, 22, 0);
  assert.equal(themeForDate(summerNoon).period, 'day');
  assert.equal(themeForDate(winterNight).period, 'night');
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
    // and the dark background in the dark modes.
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

test('light until sunset, dark after it', () => {
  assert.deepEqual(Object.keys(THEMES).sort(), ['afternoon', 'day', 'dusk', 'morning', 'night']);
  for (const name of ['morning', 'day', 'afternoon']) {
    assert.equal(THEMES[name].isDark, false, name);
    assert.ok(luminance(THEMES[name].bg) > 0.5, `${name} background should be light`);
  }
  for (const name of ['dusk', 'night']) {
    assert.equal(THEMES[name].isDark, true, name);
    assert.ok(luminance(THEMES[name].bg) < 0.1, `${name} background should be dark`);
  }
  assert.ok(luminance(THEMES.morning.bg) > 0.7, 'morning background should be pale');
});

test('every theme names its own period', () => {
  for (const [name, t] of Object.entries(THEMES)) assert.equal(t.period, name);
});

// ── the palette the spec asked for, unchanged ────────────────────────────────

test('the specified colours are carried through exactly', () => {
  assert.equal(THEMES.morning.bg, '#EEF8F6');
  assert.equal(THEMES.morning.accentDeep, '#127A76');
  assert.equal(THEMES.day.bg, '#D9EDEB');
  assert.equal(THEMES.day.text, '#0A3F3D');
  assert.equal(THEMES.night.bg, '#141B2E');
  assert.equal(THEMES.night.surface, '#1E2740');
  assert.equal(THEMES.night.text, '#EAEFF8');
  assert.equal(THEMES.night.accent, '#7EA8DC');
  assert.equal(THEMES.night.glow, 'rgba(126,168,220,0.20)');
  // Chosen from the preview: lavender before sunset, soft indigo after it.
  assert.equal(THEMES.afternoon.bg, '#E2E2EE');
  assert.equal(THEMES.dusk.bg, '#2B3246');
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
  const vars = cssVars(THEMES.night);
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

  applyTheme(THEMES.night, fakeRoot);
  assert.equal(fakeRoot.dataset.period, 'night');
  assert.equal(fakeRoot.style.colorScheme, 'dark');
});

test('applyTheme is a no-op without a DOM instead of throwing', () => {
  assert.doesNotThrow(() => applyTheme(THEMES.day, null));
});

test('the clock is re-checked often enough to catch a boundary mid-session', () => {
  assert.ok(THEME_REFRESH_MS <= 15 * 60 * 1000);
  assert.ok(THEME_REFRESH_MS >= 60 * 1000);
});
