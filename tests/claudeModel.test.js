import { test } from 'node:test';
import assert from 'node:assert/strict';
import { responseText, isRefusal, CLAUDE_MODEL } from '../src/lib/claudeModel.js';
import { MODEL_PRICES } from '../src/lib/usagePricing.js';

test('the answer is the text block, even after a thinking block', () => {
  const data = { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":1}' }] };
  assert.equal(responseText(data), '{"a":1}');
});

test('no content gives an empty answer', () => {
  assert.equal(responseText({}), '');
  assert.equal(responseText(null), '');
});

test('refusal is recognised', () => {
  assert.equal(isRefusal({ stop_reason: 'refusal' }), true);
  assert.equal(isRefusal({ stop_reason: 'end_turn' }), false);
});

test('the model the app calls has a price', () => {
  assert.ok(MODEL_PRICES[CLAUDE_MODEL]);
});
