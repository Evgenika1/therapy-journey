// Cross-session pattern analysis: what gets sent to Claude, and when.
//
// Patterns are the one view that needs the whole history at once, so the input
// has to be small enough to fit and rich enough to be worth reading. Raw
// transcripts are neither — a single session here runs to two hours — but every
// analysed session already carries a structured summary, which is exactly the
// right granularity for spotting what repeats across months.
//
// Pure functions: no React, no network, no clock of its own. Everything the
// page and the route decide (is there enough history, is the cache stale, what
// goes in the payload) is decided here and covered by tests.

import { parseAnalysis } from './analysisParse.js';

// Patterns are built from analyses, not from bare sessions — a session with no
// analysis contributes almost nothing beyond a date.
export const MIN_ANALYSED_SESSIONS = 3;

// Per-item caps. A long history must not push the request past the context
// window; these keep a hundred sessions roughly as cheap as ten.
const MAX_SESSIONS = 60;
const MAX_ITEMS_PER_FIELD = 6;
const MAX_ITEM_CHARS = 220;
const MAX_EMOTIONS = 240;
const TRANSCRIPT_FALLBACK_CHARS = 600;

const trim = (v, n = MAX_ITEM_CHARS) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null;

const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])
  .map(x => trim(x))
  .filter(Boolean)
  .slice(0, MAX_ITEMS_PER_FIELD);

const analysisOf = (s) => {
  const raw = s?.ai_analysis;
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  return parseAnalysis(raw);
};

export const hasAnalysis = (s) => !!analysisOf(s);

export function analysedSessions(sessions) {
  return (Array.isArray(sessions) ? sessions : []).filter(hasAnalysis);
}

export function canFindPatterns(sessions) {
  return analysedSessions(sessions).length >= MIN_ANALYSED_SESSIONS;
}

// Oldest first: "how things shifted over time" is unanswerable from a list in
// reverse-chronological order, which is how the app stores and shows sessions.
function byDateAscending(a, b) {
  return String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
}

const day = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : null);

// Build the compact history handed to Claude.
export function buildPatternsInput(sessions = [], emotions = []) {
  const all = (Array.isArray(sessions) ? sessions : []).slice().sort(byDateAscending);
  const analysed = all.filter(hasAnalysis);

  // When there are more sessions than the cap, keep the most recent ones —
  // recent history is what the user is actually living in.
  const kept = all.slice(-MAX_SESSIONS);

  const sessionSummaries = kept.map((s) => {
    const a = analysisOf(s);
    // Deliberately no ordinal index. Numbering every session invited the model
    // to cite "sessions 1, 8, 9" next to a count of analysed ones only, which
    // reads as a contradiction. Dates identify a session and mean something to
    // the person reading.
    const entry = {
      date: day(s.created_at),
      mood_before: s.mood_before ?? null,
      mood_after: s.mood_after ?? null,
    };
    if (a) {
      entry.key_theme = trim(a.key_theme);
      entry.topics = list(a.topics_covered);
      entry.emotions = list(a.emotions_identified);
      entry.patterns_triggers = list(a.patterns_triggers);
      entry.breakthroughs = list(a.breakthroughs);
      entry.for_next_session = list(a.for_next_session);
    } else if (s.transcript) {
      // Never analysed: a short excerpt so the topic is not simply missing from
      // the history, without dragging a two-hour transcript into the request.
      entry.excerpt = trim(s.transcript, TRANSCRIPT_FALLBACK_CHARS);
      entry.analysed = false;
    }
    return entry;
  });

  const emotionLog = (Array.isArray(emotions) ? emotions : [])
    .slice()
    .sort(byDateAscending)
    .slice(-MAX_EMOTIONS)
    .map(e => ({
      date: day(e.created_at),
      category: trim(e.category, 40),
      emotions: Array.isArray(e.sub_emotions) ? e.sub_emotions.slice(0, 6) : [],
      intensity: e.intensity ?? null,
      tag: trim(e.session_tag, 20),   // 'before' / 'after' around a session
      // The note is the only field saying what a feeling was ABOUT. Triggers
      // are hard to find without it: "Anxiety 8/10" repeats, "поругалась с
      // мамой" is what makes it a pattern.
      note: trim(e.note, 160),
    }));

  return {
    total_sessions: all.length,
    analysed_sessions: analysed.length,
    first_session: day(all[0]?.created_at),
    last_session: day(all[all.length - 1]?.created_at),
    sessions: sessionSummaries,
    emotion_log: emotionLog,
  };
}

// ── cache freshness ──────────────────────────────────────────────────────────
//
// The analysis is one Claude call over the entire history, so it is kept and
// only recomputed on demand. The signature describes the data it was built
// from; when the live history moves past it, the page says so and offers a
// refresh rather than silently showing something out of date.

export function cacheSignature(sessions = []) {
  const analysed = analysedSessions(sessions);
  const latest = analysed
    .map(s => s?.created_at || '')
    .sort()
    .pop() || null;
  return { analysed_count: analysed.length, latest_at: latest };
}

export function isStale(cached, sessions = []) {
  if (!cached?.signature) return true;
  const now = cacheSignature(sessions);
  return cached.signature.analysed_count !== now.analysed_count
      || cached.signature.latest_at !== now.latest_at;
}

// ── response shape ───────────────────────────────────────────────────────────
// Enforced server-side with structured outputs, so the model cannot answer with
// prose or a truncated object — the same approach that removed the whole
// "could not parse" failure class from /api/analyze.

const strings = { type: 'array', items: { type: 'string' } };
const objArray = (props) => ({
  type: 'array',
  items: {
    type: 'object',
    properties: Object.fromEntries(props.map(p => [p, { type: 'string' }])),
    required: props,
    additionalProperties: false,
  },
});

export const PATTERNS_SCHEMA = {
  type: 'object',
  properties: {
    recurring_themes:   objArray(['theme', 'frequency', 'insight']),
    emotional_patterns: objArray(['pattern', 'detail']),
    triggers:           objArray(['trigger', 'context']),
    shifts:             objArray(['shift', 'evidence']),
  },
  required: ['recurring_themes', 'emotional_patterns', 'triggers', 'shifts'],
  additionalProperties: false,
};

export const PATTERN_SECTIONS = [
  { key: 'recurring_themes',   label: 'Recurring themes',  icon: '◎', fields: ['theme', 'frequency', 'insight'] },
  { key: 'emotional_patterns', label: 'Emotional patterns', icon: '◍', fields: ['pattern', 'detail'] },
  { key: 'triggers',           label: 'Triggers',           icon: '◈', fields: ['trigger', 'context'] },
  { key: 'shifts',             label: 'Growth & shifts',    icon: '◇', fields: ['shift', 'evidence'] },
];

export function hasAnyPattern(analysis) {
  if (!analysis || typeof analysis !== 'object') return false;
  return PATTERN_SECTIONS.some(s => Array.isArray(analysis[s.key]) && analysis[s.key].length > 0);
}

export { strings };
