// Searching the user's own transcripts from a chat.
//
// The chat context is a compact summary of every session (see patternsInput),
// which answers "what are my sessions about" but not "find where we talked
// about X": the conversation itself is not in a summary, and two-hour
// transcripts are far too long to send whole. So the model gets a tool, and the
// server answers it with short excerpts around each match.
//
// Matching is plain case-insensitive substring search. Russian inflects
// ("мама", "маме", "мамой"), so the tool asks the model for several word forms
// rather than this file guessing at stems.
//
// Pure functions: no network, no Supabase. The route fetches the sessions.

import { stripSpeakerMarkers } from './transcriptFormat.js';

const WINDOW = 260;          // characters kept on each side of a match
const MAX_RESULTS = 8;       // excerpts returned per search
const MAX_PER_SESSION = 3;

export const SEARCH_SESSIONS_TOOL = {
  name: 'search_sessions',
  description:
    "Search the full transcripts and notes of the user's own recorded sessions. "
    + 'Use it whenever the user asks about a specific conversation, moment, person, quote or detail from their sessions '
    + 'that the session summaries do not contain, instead of asking them to retell it. '
    + 'Matching is exact and case-insensitive on substrings, so pass several word forms and synonyms '
    + '(for Russian: "мама", "маме", "мамой", "мать"; a short stem such as "мам" also works). '
    + 'Returns excerpts with the session date, newest first.',
  input_schema: {
    type: 'object',
    properties: {
      terms: {
        type: 'array',
        items: { type: 'string' },
        description: 'Words or short phrases to look for; any of them may match.',
      },
      from: { type: 'string', description: 'Optional earliest session date, YYYY-MM-DD.' },
      to:   { type: 'string', description: 'Optional latest session date, YYYY-MM-DD.' },
    },
    required: ['terms'],
  },
};

const day = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : '');

function matchRanges(lower, terms) {
  const ranges = [];
  for (const t of terms) {
    let i = lower.indexOf(t);
    while (i !== -1) {
      ranges.push([i, i + t.length]);
      i = lower.indexOf(t, i + t.length);
    }
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

// Windows around each match, merged when they overlap so one passage is not
// returned three times because it mentions the word three times.
function windows(text, ranges) {
  const out = [];
  for (const [s, e] of ranges) {
    const start = Math.max(0, s - WINDOW);
    const end = Math.min(text.length, e + WINDOW);
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

export function searchSessions(sessions = [], terms = [], { from = null, to = null } = {}) {
  const needles = (Array.isArray(terms) ? terms : [terms])
    .map(t => (typeof t === 'string' ? t.trim().toLowerCase() : ''))
    .filter(Boolean);
  if (needles.length === 0) return [];

  const hits = [];
  const ordered = (Array.isArray(sessions) ? sessions : [])
    .filter(s => s && !s.deleted_at)
    .filter(s => (!from || day(s.created_at) >= from) && (!to || day(s.created_at) <= to))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  for (const s of ordered) {
    const text = [stripSpeakerMarkers(s.transcript || ''), s.notes ? `Notes: ${s.notes}` : '']
      .filter(Boolean).join('\n\n');
    if (!text) continue;
    const ranges = matchRanges(text.toLowerCase(), needles);
    for (const [a, b] of windows(text, ranges).slice(0, MAX_PER_SESSION)) {
      hits.push({
        date: day(s.created_at),
        title: s.title || null,
        excerpt: `${a > 0 ? '…' : ''}${text.slice(a, b).trim()}${b < text.length ? '…' : ''}`,
      });
      if (hits.length >= MAX_RESULTS) return hits;
    }
  }
  return hits;
}

export function formatSearchResult(hits, terms) {
  if (!hits.length) {
    return `No matches for ${JSON.stringify(terms)} in the user's session transcripts. `
      + 'Try other word forms or synonyms, or tell the user it was not found in the recordings.';
  }
  return hits
    .map(h => `[${h.date}${h.title ? ` — ${h.title}` : ''}]\n${h.excerpt}`)
    .join('\n\n---\n\n');
}
