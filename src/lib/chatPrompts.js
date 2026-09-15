// How the AI introduces itself in a chat, by kind of session.
//
// Beside a coaching session the companion talks about goals and next steps; a
// therapy voice there — "what emotions came up?" — misses what the person came
// for. The standalone chat has no session, so it names both.

import { normalizeKind } from './sessionKind.js';
import { CHAT_SUGGESTIONS } from './chatPresets.js';

const INTRO = {
  therapy: 'You are a compassionate AI therapy companion. Be concise, warm, and insightful.',
  coaching: 'You are a supportive AI coaching companion. Help the person get clear on their goals, the next concrete step, and what is in the way. Ask one good question rather than giving a lecture. Be concise, direct and encouraging.',
};

export const GENERAL_CHAT_INTRO =
  'You are a compassionate AI companion for someone working with a therapist or a coach. Be concise, warm, and insightful.';

export function sessionChatIntro({ kind, transcript } = {}) {
  const k = normalizeKind(kind);
  const text = typeof transcript === 'string' ? transcript.trim() : '';
  if (!text) return INTRO[k];
  const label = k === 'coaching' ? 'a coaching session' : 'a therapy session';
  return `${INTRO[k]}\n\nThe user is reviewing ${label}.\n\nSession transcript:\n"${text}"`;
}

export const COACHING_SUGGESTIONS = [
  'Where am I with my goals?',
  'What did I commit to, and by when?',
  "What's really stopping me from the next step?",
];

export const suggestionsForKind = (kind) =>
  (normalizeKind(kind) === 'coaching' ? [...COACHING_SUGGESTIONS, ...CHAT_SUGGESTIONS] : CHAT_SUGGESTIONS);
