// The free trial's limits on transcription, as pure functions.
//
// The quota gate only runs before a job starts, and a recording's length is
// unknown until AssemblyAI has it. For a paying account that is fine (see
// OVERDRAFT_MINUTES), but a trial account with five minutes left could upload a
// ten-hour file, and an account farm would do exactly that. So a trial job is
// cut off where the trial ends: AssemblyAI's audio_end_at transcribes only up to
// that point and bills only that range.

import { OVERDRAFT_MINUTES } from './usageQuota.js';

// How much audio a trial account may still have transcribed, in milliseconds,
// or null when the account is not on a trial. Never under a minute: the gate
// has already let the job through, and a few seconds of transcript is useless.
export function trialAudioLimitMs(quota) {
  if (quota?.allowance?.source !== 'trial') return null;
  const minutes = Number.isFinite(quota.remaining) ? quota.remaining + OVERDRAFT_MINUTES : 0;
  return Math.round(Math.max(1, minutes) * 60_000);
}

// The seconds a finished job is billed for. AssemblyAI reports the whole
// file's audio_duration even when audio_end_at cut the transcript short, and
// charges only for the transcribed range — so the ledger does the same.
export function billedAudioSeconds(transcript) {
  const duration = Number(transcript?.audio_duration) || 0;
  const endMs = Number(transcript?.audio_end_at);
  if (Number.isFinite(endMs) && endMs > 0) return Math.round(Math.min(duration, endMs / 1000));
  return Math.round(duration);
}

// Whether the transcript stops before the end of the recording.
export function wasCutShort(transcript) {
  const endMs = Number(transcript?.audio_end_at);
  return Number.isFinite(endMs) && endMs > 0 && (Number(transcript?.audio_duration) || 0) > endMs / 1000 + 1;
}
