// When the next session is, and what the page should say about it.
//
// Pure: no React, no storage, no clock of its own — "now" is always passed in,
// which is the only way the boundary between "counting down" and "this already
// happened" can be tested rather than waited for.

export const SESSION_DATE_KEY = 'tj_next_session_date';

// Three states, never a fourth. The old code had only "there is a date" and
// "there isn't", so a date in the past fell into the first branch and rendered
// 00:00:00 — a countdown that looks broken rather than out of date.
export function countdownFrom(value, now = new Date()) {
  if (typeof value !== 'string' || !value.trim()) return { status: 'none' };

  const target = new Date(value);
  // A stored value can be anything: hand-edited localStorage, a half-typed date
  // the picker emitted, a format from an older build. Unparseable is treated as
  // "not set" rather than crashing the page it is on.
  if (Number.isNaN(target.getTime())) return { status: 'none' };

  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return { status: 'past', target };

  return {
    status: 'future',
    target,
    ms,
    days:  Math.floor(ms / 86400000),
    hours: Math.floor((ms % 86400000) / 3600000),
    mins:  Math.floor((ms % 3600000) / 60000),
  };
}
