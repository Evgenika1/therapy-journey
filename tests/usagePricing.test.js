// What a request actually cost, in dollars.
//
// Money is the ledger's unit because it is the only one all four sources share:
// audio is billed by the hour, the three Claude calls by the token. Minutes —
// what the user sees — are derived from this at display time, never stored, so
// changing the rate later cannot make the history disagree with itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  claudeCost, audioCost, MODEL_PRICES,
  CACHE_READ_MULTIPLIER, CACHE_WRITE_MULTIPLIER, ASSEMBLYAI_USD_PER_HOUR,
} from '../src/lib/usagePricing.js';

const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: ${actual} != ${expected}`);

// ── Claude ───────────────────────────────────────────────────────────────────

test('input and output tokens are priced separately', () => {
  // Haiku 4.5: $1.00 per 1M in, $5.00 per 1M out.
  const cost = claudeCost({
    model: 'claude-haiku-4-5',
    input_tokens: 1_000_000,
    output_tokens: 0,
  });
  near(cost, 1.00, 'a million input tokens');

  const out = claudeCost({ model: 'claude-haiku-4-5', input_tokens: 0, output_tokens: 1_000_000 });
  near(out, 5.00, 'a million output tokens');
});

test('a realistic analysis costs cents, not dollars', () => {
  const cost = claudeCost({
    model: 'claude-haiku-4-5',
    input_tokens: 10_000,
    output_tokens: 4_000,
  });
  near(cost, 0.01 + 0.02, 'ten thousand in, four thousand out');
});

test('cached tokens are cheaper to read and dearer to write', () => {
  const read = claudeCost({
    model: 'claude-haiku-4-5', input_tokens: 0, output_tokens: 0,
    cache_read_input_tokens: 1_000_000,
  });
  near(read, 1.00 * CACHE_READ_MULTIPLIER, 'cache reads');

  const write = claudeCost({
    model: 'claude-haiku-4-5', input_tokens: 0, output_tokens: 0,
    cache_creation_input_tokens: 1_000_000,
  });
  near(write, 1.00 * CACHE_WRITE_MULTIPLIER, 'cache writes');
});

test('the dated model id is priced the same as the bare one', () => {
  // The routes send claude-haiku-4-5-20251001; the price table must not miss it
  // and silently bill the request at zero.
  const usage = { input_tokens: 500_000, output_tokens: 100_000 };
  near(
    claudeCost({ model: 'claude-haiku-4-5-20251001', ...usage }),
    claudeCost({ model: 'claude-haiku-4-5', ...usage }),
    'dated snapshot',
  );
});

test('every model the app actually calls has a price', () => {
  // Guards the failure this file exists to prevent: a model swapped in the route
  // and not in the table, which would log tokens at zero cost forever.
  for (const id of ['claude-haiku-4-5', 'claude-haiku-4-5-20251001']) {
    assert.ok(MODEL_PRICES[id], `${id} is missing from MODEL_PRICES`);
  }
});

test('an unpriced model is loud, not silently free', () => {
  assert.throws(
    () => claudeCost({ model: 'claude-opus-5', input_tokens: 1000, output_tokens: 1000 }),
    /price/i,
    'the caller must decide what to do, rather than record a zero',
  );
});

test('missing usage fields count as zero rather than NaN', () => {
  // A response that omits cache fields is normal, and must not poison the ledger
  // with NaN — which would make every later sum NaN too.
  const cost = claudeCost({ model: 'claude-haiku-4-5', input_tokens: 100 });
  assert.ok(Number.isFinite(cost));
  near(cost, 100 / 1_000_000, 'input only');
});

// ── audio ────────────────────────────────────────────────────────────────────

test('audio is billed pro rata from the hourly rate', () => {
  near(audioCost(3600), ASSEMBLYAI_USD_PER_HOUR, 'one hour');
  near(audioCost(1800), ASSEMBLYAI_USD_PER_HOUR / 2, 'half an hour');
  near(audioCost(0), 0, 'nothing recorded');
});

test('a missing or nonsense duration costs nothing rather than NaN', () => {
  near(audioCost(null), 0, 'null');
  near(audioCost(undefined), 0, 'undefined');
  near(audioCost(-5), 0, 'negative');
});
