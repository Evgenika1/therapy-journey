// The free trial's cut-off. A trial account's job must stop where its minutes
// end, and be billed for only that much — otherwise one trial account could
// push hours of audio through for free.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { trialAudioLimitMs, billedAudioSeconds, wasCutShort } from '../src/lib/freeTrial.js';
import { OVERDRAFT_MINUTES } from '../src/lib/usageQuota.js';

test('only a trial gets a cut-off, at exactly what is left of it', () => {
  assert.equal(trialAudioLimitMs({ allowance: { source: 'plan' }, remaining: 5 }), null);
  assert.equal(trialAudioLimitMs({ allowance: { source: 'override' }, remaining: 5 }), null);
  assert.equal(trialAudioLimitMs({ allowance: { source: 'trial' }, remaining: 30 }), 30 * 60_000);
  assert.equal(trialAudioLimitMs({ allowance: { source: 'trial' }, remaining: 28.7 }), Math.round(28.7 * 60_000));
});

test('the cut-off is never under a minute, nor nonsense on a bad number', () => {
  assert.equal(trialAudioLimitMs({ allowance: { source: 'trial' }, remaining: -3 }), 60_000);
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

import { cutPointSeconds, recordingWasCut, cutNote } from '../src/lib/freeTrial.js';

test('the cut is seen from the recording length, not AssemblyAI duration', () => {
  // Live: a 48:07 recording came back with audio_duration 2700 and audio_end_at 2700000.
  const t = { audio_duration: 2700, audio_end_at: 2_700_000 };
  assert.equal(cutPointSeconds(t), 2700);
  assert.equal(recordingWasCut(2887, cutPointSeconds(t)), true);
  assert.equal(recordingWasCut(1981, cutPointSeconds(t)), false);
  assert.equal(recordingWasCut(2887, null), false);
});

test('the note names where it stops', () => {
  assert.match(cutNote(2700), /stops at 45:00/);
});

import { alreadyTranscribedSeconds } from '../src/lib/freeTrial.js';
test('a whole-session transcript is billed only past the trial cut, capped at the trial', () => {
  assert.equal(alreadyTranscribedSeconds('…\n\n— Transcript stops at 30:00: your free minutes ran out —', 30), 1800);
  assert.equal(alreadyTranscribedSeconds('— Transcript stops at 21:15: … —', 30), 1275);
  assert.equal(alreadyTranscribedSeconds('— Transcript stops at 99:00: … —', 30), 1800); // edited note
  assert.equal(alreadyTranscribedSeconds('no note here', 30), 0);
  assert.equal(alreadyTranscribedSeconds(null, 30), 0);
});
