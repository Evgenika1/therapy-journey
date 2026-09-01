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

export const ANALYSIS_FIELDS = [
  { key: 'topics_covered',              label: 'TOPICS COVERED',      color: '#0EA5E9', type: 'array'  },
  { key: 'overview',                    label: 'OVERVIEW',            color: '#3B82F6', type: 'array'  },
  { key: 'key_theme',                   label: 'KEY THEME',           color: '#8B5CF6', type: 'string' },
  { key: 'breakthroughs',               label: 'BREAKTHROUGHS',       color: '#10B981', type: 'array'  },
  { key: 'emotions_identified',         label: 'EMOTIONS IDENTIFIED', color: '#EC4899', type: 'array'  },
  { key: 'action_items',                label: 'ACTION ITEMS',        color: '#F59E0B', type: 'array'  },
  { key: 'patterns_triggers',           label: 'PATTERNS / TRIGGERS', color: '#EF4444', type: 'array'  },
  { key: 'continuity_notes',            label: 'CONTINUITY NOTES',    color: '#14B8A6', type: 'array'  },
  { key: 'for_next_session',            label: 'FOR NEXT SESSION',    color: '#6366F1', type: 'array'  },
  { key: 'emotional_intensity_markers', label: 'EMOTIONAL INTENSITY', color: '#DC2626', type: 'array'  },
];

// Keys produced by analyses generated before the 10-section rewrite. Rendered
// when present so old sessions don't go blank, but never requested from the model.
export const LEGACY_ANALYSIS_FIELDS = [
  { key: 'breakthrough', label: 'BREAKTHROUGH', color: '#10B981', type: 'string' },
  { key: 'action',       label: 'ACTION',       color: '#F59E0B', type: 'string' },
];

// Structured-outputs JSON schema, built from the field list above. Structured
// outputs requires every object to declare `required` and
// `additionalProperties: false`.
export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(ANALYSIS_FIELDS.map(f => [
    f.key,
    f.type === 'array'
      ? { type: 'array', items: { type: 'string' } }
      : { type: ['string', 'null'] },
  ])),
  required: ANALYSIS_FIELDS.map(f => f.key),
  additionalProperties: false,
};

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
export function analysisToText(ai) {
  if (!ai || typeof ai !== 'object') return '';
  const blocks = [];
  for (const { key, label } of [...ANALYSIS_FIELDS, ...LEGACY_ANALYSIS_FIELDS]) {
    const v = ai[key];
    if (!hasValue(v)) continue;
    const body = Array.isArray(v)
      ? v.filter(x => hasValue(x)).map(x => `• ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n')
      : String(v).trim();
    blocks.push(`${label}\n${body}`);
  }
  return blocks.join('\n\n');
}
