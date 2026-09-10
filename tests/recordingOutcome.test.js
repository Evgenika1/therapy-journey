// What happens to a recording the moment it stops — and in what ORDER.
//
// Both rules pinned here were, until now, wrong in ways that destroyed real
// audio:
//
//   1. The silence guard returned BEFORE the audio was written to IndexedDB, so
//      a recording the guard misjudged (a quiet mic, not a silent room) was
//      gone with no recovery banner to offer it back.
//   2. Closing the modal deleted the held audio unless transcription had
//      failed — so a transcript that came back fine but was never saved took
//      the audio with it.
//
// These are ordering/lifecycle rules, not maths, so the tests assert on the
// sequence of effects rather than on return values alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  finishRecording, isSilent, shouldClearHeldAudioOnClose,
  MIN_RECORDING_BYTES, SPEECH_WINDOW_RMS, SILENCE_PEAK_FLOOR,
} from '../src/lib/recordingOutcome.js';

// A recorded blob stand-in: only `size` and `type` are ever read here.
const blobOf = (size, type = 'audio/webm') => ({ size, type });

// Records the order effects fire in, so "held before anything could reject it"
// is an assertion and not a hope.
function spies({ measurement = { loudestWindowRms: 0.4, peak: 0.9 }, measureThrows = null } = {}) {
  const calls = [];
  return {
    calls,
    hold: async (rec) => { calls.push(['hold', rec.blob.size, rec.seconds]); },
    measure: async () => {
      calls.push(['measure']);
      if (measureThrows) throw new Error(measureThrows);
      return measurement;
    },
    transcribe: async () => { calls.push(['transcribe']); },
  };
}

// ── the silence guard must never outrun the save ─────────────────────────────

test('holds the audio BEFORE measuring, so a silent verdict cannot lose it', async () => {
  const s = spies({ measurement: { loudestWindowRms: 0.001, peak: 0.004 } });
  const out = await finishRecording(
    { blob: blobOf(2_000_000), mimeType: 'audio/webm', seconds: 5460 }, s,
  );

  assert.equal(out.outcome, 'silent');
  assert.equal(out.held, true);
  // The order is the fix: hold, then measure. Never the other way round.
  assert.deepEqual(s.calls, [['hold', 2_000_000, 5460], ['measure']]);
});

test('a silent recording is held but not sent for transcription', async () => {
  const s = spies({ measurement: { loudestWindowRms: 0.001, peak: 0.004 } });
  await finishRecording({ blob: blobOf(50_000), mimeType: 'audio/webm', seconds: 60 }, s);
  assert.ok(!s.calls.some(c => c[0] === 'transcribe'));
  assert.ok(s.calls.some(c => c[0] === 'hold'));
});

test('audible speech is held and transcribed', async () => {
  const s = spies({ measurement: { loudestWindowRms: 0.4, peak: 0.9 } });
  const out = await finishRecording({ blob: blobOf(50_000), mimeType: 'audio/webm', seconds: 60 }, s);
  assert.equal(out.outcome, 'transcribing');
  assert.deepEqual(s.calls.map(c => c[0]), ['hold', 'measure', 'transcribe']);
});

test('a decode failure holds the audio and lets the server decide', async () => {
  // decodeAudioData throws on some container/codec combinations. That must not
  // be read as silence, and above all must not discard the recording.
  const s = spies({ measureThrows: 'EncodingError' });
  const out = await finishRecording({ blob: blobOf(50_000), mimeType: 'audio/mp4', seconds: 60 }, s);
  assert.equal(out.outcome, 'transcribing');
  assert.equal(out.held, true);
  assert.deepEqual(s.calls.map(c => c[0]), ['hold', 'measure', 'transcribe']);
});

test('a sub-1KB blob is not a recording — nothing is held or transcribed', async () => {
  const s = spies();
  const out = await finishRecording({ blob: blobOf(MIN_RECORDING_BYTES - 1), mimeType: 'audio/webm', seconds: 0 }, s);
  assert.equal(out.outcome, 'too-short');
  assert.equal(out.held, false);
  assert.deepEqual(s.calls, []);
});

test('a hold that fails still lets transcription proceed', async () => {
  // savePendingRecording is best-effort: private windows and blocked site data
  // throw. A failed cache must never take down the recording flow itself.
  const calls = [];
  const out = await finishRecording({ blob: blobOf(50_000), mimeType: 'audio/webm', seconds: 60 }, {
    hold: async () => { calls.push('hold'); throw new Error('QuotaExceededError'); },
    measure: async () => { calls.push('measure'); return { loudestWindowRms: 0.4, peak: 0.9 }; },
    transcribe: async () => { calls.push('transcribe'); },
  });
  assert.equal(out.outcome, 'transcribing');
  assert.equal(out.held, false);
  assert.deepEqual(calls, ['hold', 'measure', 'transcribe']);
});

// ── the silence rule itself ──────────────────────────────────────────────────

test('both signals must agree before a recording is called silent', () => {
  // A false skip loses data; a false pass costs one empty API round-trip.
  assert.equal(isSilent({ loudestWindowRms: 0.001, peak: 0.004 }), true);
  assert.equal(isSilent({ loudestWindowRms: 0.001, peak: SILENCE_PEAK_FLOOR + 0.01 }), false,
    'a loud transient means someone spoke');
  assert.equal(isSilent({ loudestWindowRms: SPEECH_WINDOW_RMS + 0.01, peak: 0.004 }), false,
    'a speech-level window means someone spoke');
});

test('an unmeasurable recording is never called silent', () => {
  assert.equal(isSilent({ loudestWindowRms: null, peak: 0 }), false);
  assert.equal(isSilent({}), false);
});

// ── closing the modal is not a discard ───────────────────────────────────────

test('closing the modal only clears the audio once the session is saved', () => {
  assert.equal(shouldClearHeldAudioOnClose({ saved: true }), true);
  assert.equal(shouldClearHeldAudioOnClose({ saved: false }), false);
});

test('a successful transcript that was never saved keeps its audio', () => {
  // The regression this exists to catch: the old rule was
  // `!(transcribeFailed && !saved)`, which deleted the audio here.
  assert.equal(shouldClearHeldAudioOnClose({ saved: false, transcribeFailed: false }), false);
});

test('a failed transcription keeps its audio for the recovery banner', () => {
  assert.equal(shouldClearHeldAudioOnClose({ saved: false, transcribeFailed: true }), false);
});
