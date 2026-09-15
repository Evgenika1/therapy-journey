// Goals across coaching sessions.
//
// There is no goals table. A coaching analysis returns the goals as they stand
// after that session, and the next analysis is given those to compare against.
// So "the goals" are always whatever the latest analysed coaching session said
// — which keeps them tied to what was actually said in the room.
//
// Pure functions: no React, no network, no clock.

import { parseAnalysis } from './analysisParse.js';
import { kindOf } from './sessionKind.js';

export const GOAL_STATUSES = ['new', 'in_progress', 'changed', 'achieved', 'dropped'];
export const OPEN_GOAL_STATUSES = ['new', 'in_progress', 'changed'];
export const GOAL_STATUS_LABELS = {
  new: 'New', in_progress: 'In progress', changed: 'Changed', achieved: 'Achieved', dropped: 'Set aside',
};
export const MAX_CURRENT_GOALS = 5;

const text = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export function normalizeGoals(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(g => g && typeof g.goal === 'string' && g.goal.trim())
    .map(g => ({
      goal:     text(g.goal, 200),
      status:   GOAL_STATUSES.includes(g.status) ? g.status : 'in_progress',
      progress: text(g.progress, 300),
    }));
}

const analysisOf = (s) => {
  const raw = s?.ai_analysis;
  if (!raw) return null;
  return typeof raw === 'object' ? raw : parseAnalysis(raw);
};

// Newest first; the first analysed coaching session with a goals list wins.
function latestCoachingGoals(sessions, before) {
  const candidates = (Array.isArray(sessions) ? sessions : [])
    .filter(s => s && !s.deleted_at && kindOf(s) === 'coaching')
    .filter(s => before == null || String(s.created_at || '') < before)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  for (const s of candidates) {
    const a = analysisOf(s);
    if (a && Array.isArray(a.goals)) return { session: s, goals: normalizeGoals(a.goals) };
  }
  return null;
}

// Goals to hand to the analysis of `current`. Closed goals are included: the
// model has to know a goal was achieved to avoid proposing it again as new.
export function previousGoals(sessions, current) {
  const others = (Array.isArray(sessions) ? sessions : []).filter(s => s?.id !== current?.id);
  return latestCoachingGoals(others, current?.created_at ?? null)?.goals ?? [];
}

// The Dashboard card: open goals from the latest analysed coaching session, or
// null when there is none, so the card is not shown at all.
export function currentGoals(sessions) {
  const found = latestCoachingGoals(sessions, null);
  if (!found) return null;
  return {
    session: found.session,
    goals: found.goals.filter(g => OPEN_GOAL_STATUSES.includes(g.status)).slice(0, MAX_CURRENT_GOALS),
  };
}
