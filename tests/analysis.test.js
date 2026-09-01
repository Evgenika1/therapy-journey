// Critical path: session transcript → /api/analyze → parsed analysis → UI.
//
// Every bug this file guards against was live in the app: the model's JSON
// arriving fenced or truncated, and readers looking up field names the schema
// has never produced (`summary`, `action`), which failed silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAnalysis } from '../src/lib/analysisParse.js';
import {
  ANALYSIS_FIELDS, ANALYSIS_SCHEMA, analysisHeadline, analysisToText, hasValue,
} from '../src/lib/analysisFormat.js';

const FULL = {
  topics_covered: ['тревога перед встречей'],
  overview: ['Клиент говорил о тревоге.', 'Обсудили границы.'],
  key_theme: 'страх отвержения',
  breakthroughs: ['осознал паттерн'],
  emotions_identified: ['тревога — перед встречей'],
  action_items: ['вести дневник тревоги'],
  patterns_triggers: ['избегание конфликта'],
  continuity_notes: [],
  for_next_session: ['вернуться к теме матери'],
  emotional_intensity_markers: ['слёзы на 40-й минуте'],
};

// ── parseAnalysis ────────────────────────────────────────────────────────────

test('parses plain JSON', () => {
  assert.deepEqual(parseAnalysis(JSON.stringify(FULL)), FULL);
});

test('parses JSON wrapped in a markdown fence', () => {
  assert.deepEqual(parseAnalysis('```json\n' + JSON.stringify(FULL) + '\n```'), FULL);
});

test('parses JSON with prose before and after it', () => {
  const raw = `Here is the analysis:\n${JSON.stringify(FULL)}\nHope that helps.`;
  assert.deepEqual(parseAnalysis(raw), FULL);
});

test('does not choke on braces inside Russian string values', () => {
  const tricky = { ...FULL, key_theme: 'он сказал: "{ это не объект }" и ушёл' };
  assert.deepEqual(parseAnalysis(JSON.stringify(tricky)), tricky);
});

test('returns null for a truncated object rather than throwing', () => {
  const cut = JSON.stringify(FULL).slice(0, 120);
  assert.equal(parseAnalysis(cut), null);
});

test('returns null for empty and non-JSON responses', () => {
  assert.equal(parseAnalysis(''), null);
  assert.equal(parseAnalysis('   '), null);
  assert.equal(parseAnalysis(null), null);
  assert.equal(parseAnalysis('I cannot analyse this transcript.'), null);
});

// ── schema ↔ readers contract ────────────────────────────────────────────────

test('schema requires exactly the declared fields', () => {
  const keys = ANALYSIS_FIELDS.map(f => f.key);
  assert.deepEqual(ANALYSIS_SCHEMA.required, keys);
  assert.deepEqual(Object.keys(ANALYSIS_SCHEMA.properties), keys);
});

test('schema satisfies the structured-outputs constraints', () => {
  // Anthropic structured outputs rejects a schema whose objects allow extra
  // properties or omit `required`.
  assert.equal(ANALYSIS_SCHEMA.additionalProperties, false);
  assert.equal(ANALYSIS_SCHEMA.type, 'object');
  for (const f of ANALYSIS_FIELDS) {
    const p = ANALYSIS_SCHEMA.properties[f.key];
    if (f.type === 'array') assert.deepEqual(p, { type: 'array', items: { type: 'string' } });
    else assert.deepEqual(p, { type: ['string', 'null'] });
  }
});

test('a model response matching the schema is fully readable', () => {
  // Guards the class of bug where a reader looks up a key the model never emits.
  const parsed = parseAnalysis(JSON.stringify(FULL));
  for (const { key } of ANALYSIS_FIELDS) {
    assert.ok(key in parsed, `analysis is missing ${key}`);
  }
});

// ── headline (Dashboard) ─────────────────────────────────────────────────────

test('headline prefers key_theme', () => {
  assert.equal(analysisHeadline(FULL), 'страх отвержения');
});

test('headline falls back to the first overview line, then breakthroughs', () => {
  assert.equal(analysisHeadline({ ...FULL, key_theme: null }), 'Клиент говорил о тревоге.');
  assert.equal(
    analysisHeadline({ ...FULL, key_theme: '', overview: [] }),
    'осознал паттерн',
  );
});

test('headline never returns a raw JSON blob', () => {
  // The Dashboard used to read a non-existent `summary` field and fall through
  // to printing the whole serialized analysis in the insight card.
  const empty = Object.fromEntries(ANALYSIS_FIELDS.map(f => [f.key, f.type === 'array' ? [] : null]));
  assert.equal(analysisHeadline(empty), null);
  assert.equal(analysisHeadline(JSON.stringify(FULL)), null);
  assert.equal(analysisHeadline(null), null);
});

// ── clipboard text ───────────────────────────────────────────────────────────

test('copy text renders arrays as bullets, not comma runs', () => {
  const text = analysisToText(FULL);
  assert.match(text, /OVERVIEW\n• Клиент говорил о тревоге\.\n• Обсудили границы\./);
  assert.match(text, /KEY THEME\nстрах отвержения/);
  assert.ok(!text.includes('[object Object]'));
  assert.ok(!text.includes('Клиент говорил о тревоге.,'), 'arrays must not be comma-joined');
});

test('copy text includes action items and skips empty sections', () => {
  const text = analysisToText(FULL);
  assert.match(text, /ACTION ITEMS\n• вести дневник тревоги/);
  assert.ok(!text.includes('CONTINUITY NOTES'), 'empty arrays should be omitted');
});

test('copy text still renders legacy pre-rewrite analyses', () => {
  const text = analysisToText({ overview: 'old free text', action: 'do the thing' });
  assert.match(text, /OVERVIEW\nold free text/);
  assert.match(text, /ACTION\ndo the thing/);
});

test('hasValue distinguishes empty from present', () => {
  assert.equal(hasValue([]), false);
  assert.equal(hasValue(['a']), true);
  assert.equal(hasValue(''), false);
  assert.equal(hasValue('  '), false);
  assert.equal(hasValue(null), false);
  assert.equal(hasValue('x'), true);
});
