// The coaching prompt is where "goals carry over" actually happens: the model is
// told what the goals were and asked what became of them. These tests pin that
// the previous goals, the rules and the transcript all reach it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { coachingPrompt } from '../src/lib/coachingPrompt.js';

const base = { transcript: 'Coach: What will you do by Friday?\nClient: Email two clients.' };

test('the transcript and the language directive reach the prompt', () => {
  const p = coachingPrompt({ ...base, languageDirective: 'CRITICAL: Russian.' });
  assert.match(p, /Email two clients\./);
  assert.ok(p.trimEnd().endsWith('CRITICAL: Russian.'));
});

test('previous goals are handed over as JSON with the instruction to compare', () => {
  const p = coachingPrompt({ ...base, previousGoals: [{ goal: 'Launch the course', status: 'in_progress', progress: 'outline' }] });
  assert.match(p, /"goal": "Launch the course"/);
  assert.match(p, /previous coaching session/i);
  assert.doesNotMatch(p, /first analysed coaching session/i);
});

test('with no previous goals every goal is new', () => {
  const p = coachingPrompt(base);
  assert.match(p, /first analysed coaching session/i);
  assert.match(p, /"new"/);
});

test('notes are included only when there are some', () => {
  assert.match(coachingPrompt({ ...base, notes: 'Bring pricing' }), /Session notes:\nBring pricing/);
  assert.doesNotMatch(coachingPrompt({ ...base, notes: '  ' }), /Session notes:/);
});

test('the rules the spec requires are in the prompt', () => {
  const p = coachingPrompt(base);
  assert.match(p, /SAME language as the transcript/);
  assert.match(p, /actually agreed/i);
  assert.match(p, /never diagnose/i);
  assert.match(p, /empty array is better/i);
  for (const key of ['goals', 'homework', 'obstacles', 'insights', 'for_next_session', 'topics_covered', 'overview']) {
    assert.match(p, new RegExp(`"${key}"`), `prompt must describe ${key}`);
  }
});
