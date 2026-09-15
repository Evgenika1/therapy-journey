// The single definition of the AI analysis shape.
//
// This file exists because the shape was previously written out three times —
// the JSON schema in /api/analyze, the section list in the Sessions summary tab,
// and ad-hoc field reads on the Dashboard and in "copy summary". They drifted:
// the Dashboard read `summary` and the homework hook read `action`, neither of
// which the model has ever been asked to return. Both failed silently.
//
// Everything downstream now derives from ANALYSIS_FIELDS, so a renamed field
// breaks one list instead of quietly disabling a feature.

import { normalizeKind } from './sessionKind.js';
import { GOAL_STATUSES, GOAL_STATUS_LABELS } from './coachingGoals.js';

export const ANALYSIS_FIELDS = [
  { key: 'topics_covered',              label: 'TOPICS COVERED',      color: '#0EA5E9', type: 'array'  },
  { key: 'overview',                    label: 'OVERVIEW',            color: '#3B82F6', type: 'array'  },
  { key: 'key_theme',                   label: 'KEY THEME',           color: '#8B5CF6', type: 'string' },
  { key: 'breakthroughs',               label: 'BREAKTHROUGHS',       color: '#10B981', type: 'array'  },
  { key: 'emotions_identified',         label: 'EMOTIONS IDENTIFIED', color: '#EC4899', type: 'array'  },
  { key: 'homework',                    label: 'SUGGESTED PRACTICES', color: '#F59E0B', type: 'objects', itemFields: ['task', 'context'] },
  { key: 'patterns_triggers',           label: 'PATTERNS / TRIGGERS', color: '#EF4444', type: 'array'  },
  { key: 'continuity_notes',            label: 'CONTINUITY NOTES',    color: '#14B8A6', type: 'array'  },
  { key: 'for_next_session',            label: 'FOR NEXT SESSION',    color: '#6366F1', type: 'array'  },
  { key: 'emotional_intensity_markers', label: 'EMOTIONAL INTENSITY', color: '#DC2626', type: 'array'  },
];

// Keys produced by analyses generated before the 10-section rewrite. Rendered
// when present so old sessions don't go blank, but never requested from the model.
export const LEGACY_ANALYSIS_FIELDS = [
  { key: 'breakthrough', label: 'BREAKTHROUGH',  color: '#10B981', type: 'string' },
  { key: 'action',       label: 'ACTION',        color: '#F59E0B', type: 'string' },
  // Every analysis run before suggested practices existed carries these. Still
  // rendered, never requested — an old session must not go blank because the
  // shape moved on.
  { key: 'action_items', label: 'ACTION ITEMS',  color: '#F59E0B', type: 'array'  },
];

// A coaching session is read for where the person is heading, not for what they
// felt. `homework` and `for_next_session` keep their therapy names on purpose:
// the code that turns them into tasks and topics then works for both kinds.
export const COACHING_FIELDS = [
  { key: 'topics_covered',   label: 'TOPICS COVERED',   color: '#0EA5E9', type: 'array' },
  { key: 'overview',         label: 'OVERVIEW',         color: '#3B82F6', type: 'array' },
  { key: 'goals',            label: 'GOALS',            color: '#10B981', type: 'objects', itemFields: ['goal', 'status', 'progress'] },
  { key: 'homework',         label: 'NEXT STEPS',       color: '#F59E0B', type: 'objects', itemFields: ['task', 'due', 'context'] },
  { key: 'obstacles',        label: 'OBSTACLES',        color: '#EF4444', type: 'objects', itemFields: ['obstacle', 'context'] },
  { key: 'insights',         label: 'INSIGHTS',         color: '#8B5CF6', type: 'array' },
  { key: 'for_next_session', label: 'FOR NEXT SESSION', color: '#6366F1', type: 'array' },
];

// Item properties that are not a plain string.
const ITEM_TYPES = {
  status: { type: 'string', enum: GOAL_STATUSES },
  due:    { type: ['string', 'null'] },
};

// Structured-outputs JSON schema, built from the field list above. Structured
// outputs requires every object to declare `required` and
// `additionalProperties: false`.
function buildSchema(fields) {
  return {
    type: 'object',
    properties: Object.fromEntries(fields.map(f => [
      f.key,
      f.type === 'objects'
        // An array of small objects rather than strings: a practice that does not
        // say which part of the session it came from reads as generic advice, and
        // generic advice is what this feature exists to avoid.
        ? {
            type: 'array',
            items: {
              type: 'object',
              properties: Object.fromEntries(f.itemFields.map(k => [k, ITEM_TYPES[k] ?? { type: 'string' }])),
              required: f.itemFields,
              additionalProperties: false,
            },
          }
        : f.type === 'array'
          ? { type: 'array', items: { type: 'string' } }
          : { type: ['string', 'null'] },
    ])),
    required: fields.map(f => f.key),
    additionalProperties: false,
  };
}

export const ANALYSIS_SCHEMA = buildSchema(ANALYSIS_FIELDS);
export const COACHING_SCHEMA = buildSchema(COACHING_FIELDS);

export const fieldsForKind = (kind) => (normalizeKind(kind) === 'coaching' ? COACHING_FIELDS : ANALYSIS_FIELDS);
export const schemaForKind = (kind) => (normalizeKind(kind) === 'coaching' ? COACHING_SCHEMA : ANALYSIS_SCHEMA);

// What kind an analysis actually is, independent of the session's current
// kind. A session's kind can be switched after it was analysed — the old
// analysis is not deleted or regenerated, so rendering it by the session's
// kind can hide or relabel sections that are actually there. A coaching
// analysis always has `goals` (COACHING_SCHEMA requires it); a therapy one
// never does.
export const analysisKind = (ai) =>
  (ai && typeof ai === 'object' && Array.isArray(ai.goals)) ? 'coaching' : 'therapy';

export const hasValue = v => Array.isArray(v)
  ? v.length > 0
  : (v != null && String(v).trim() !== '');

// One short line for the Dashboard's "Latest AI Insight" card. Returns null
// rather than a fallback so the caller can render its own empty state — the old
// code fell through to the raw JSON string and printed it verbatim.
export function analysisHeadline(ai) {
  if (!ai || typeof ai !== 'object') return null;
  const first = key => {
    const v = ai[key];
    if (Array.isArray(v)) return v.find(x => typeof x === 'string' && x.trim()) || null;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  return first('key_theme')
    || first('overview')
    || first('breakthroughs')
    || first('breakthrough') // legacy
    || null;
}

// Full plain-text rendering, used by "copy summary". Arrays become bullet
// lines; the previous version interpolated them straight into a template and
// produced comma-joined runs.
// One analysis item as a line of text. Objects (a suggested practice) read as
// "task — context"; anything else falls back to its string form rather than to
// JSON.stringify, which used to leak braces into the copied summary.
export function itemToText(item) {
  if (item == null) return '';
  if (typeof item === 'string') return item.trim();
  if (typeof item === 'object') {
    const s = k => (typeof item[k] === 'string' ? item[k].trim() : '');
    if (s('goal')) {
      const status = GOAL_STATUS_LABELS[item.status];
      return [s('goal'), status && `(${status})`, s('progress') && `— ${s('progress')}`].filter(Boolean).join(' ');
    }
    const head = s('obstacle') || s('task');
    const due  = s('due');
    const main = head && due ? `${head} (${due})` : head;
    const ctx  = s('context');
    if (main && ctx) return `${main} — ${ctx}`;
    return main || ctx || '';
  }
  return String(item);
}

export function analysisToText(ai, kind) {
  if (!ai || typeof ai !== 'object') return '';
  const blocks = [];
  for (const { key, label } of [...fieldsForKind(kind), ...LEGACY_ANALYSIS_FIELDS]) {
    const v = ai[key];
    if (!hasValue(v)) continue;
    const body = Array.isArray(v)
      ? v.filter(x => hasValue(x)).map(x => `• ${itemToText(x)}`).join('\n')
      : String(v).trim();
    blocks.push(`${label}\n${body}`);
  }
  return blocks.join('\n\n');
}
