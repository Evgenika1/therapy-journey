// The free trial's cut-off. A trial account's job must stop where its minutes
// end, and be billed for only that much — otherwise one trial account could
// push hours of audio through for free.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { trialAudioLimitMs, billedAudioSeconds, wasCutShort } from '../src/lib/freeTrial.js';
import { OVERDRAFT_MINUTES } from '../src/lib/usageQuota.js';

test('only a trial gets a cut-off, at what is left plus the overdraft', () => {
  assert.equal(trialAudioLimitMs({ allowance: { source: 'plan' }, remaining: 5 }), null);
  assert.equal(trialAudioLimitMs({ allowance: { source: 'override' }, remaining: 5 }), null);
  assert.equal(trialAudioLimitMs({ allowance: { source: 'trial' }, remaining: 30 }), (30 + OVERDRAFT_MINUTES) * 60_000);
});

test('the cut-off is never under a minute, nor nonsense on a bad number', () => {
  assert.equal(trialAudioLimitMs({ allowance: { source: 'trial' }, remaining: -OVERDRAFT_MINUTES }), 60_000);
  assert.equal(trialAudioLimitMs({ allowance: { source: 'trial' }, remaining: NaN }), 60_000);
});

test('a cut job is billed for the transcribed range, not the whole file', () => {
  assert.equal(billedAudioSeconds({ audio_duration: 7200, audio_end_at: 45 * 60_000 }), 2700);
  assert.equal(billedAudioSeconds({ audio_duration: 600, audio_end_at: 45 * 60_000 }), 600, 'a short file is billed as itself');
  assert.equal(billedAudioSeconds({ audio_duration: 1234.4 }), 1234);
  assert.equal(billedAudioSeconds({}), 0);
});

test('cut short only when the file ran past the cut-off', () => {
  assert.equal(wasCutShort({ audio_duration: 7200, audio_end_at: 45 * 60_000 }), true);
  assert.equal(wasCutShort({ audio_duration: 600, audio_end_at: 45 * 60_000 }), false);
  assert.equal(wasCutShort({ audio_duration: 7200 }), false);
});
