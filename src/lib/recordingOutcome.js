// What happens to a recording the moment it stops — and in what order.
//
// This lives outside the page because the order is the part that matters and
// the part that kept getting it wrong. Two recordings were destroyed by rules
// that read as harmless in place:
//
//   • The silence guard returned before the blob reached IndexedDB, so a
//     recording it misjudged — a quiet mic, not a silent room — was gone with
//     no recovery banner to offer it back.
//   • Closing the modal deleted the held audio unless transcription had failed,
//     so a transcript that came back fine but was never saved took the audio
//     with it.
//
// The rule now: nothing that can reject a recording runs before the recording
// is safely held, and only two things ever delete it — a successful save and an
// explicit Discard.

// Below this a "recording" is a container header and nothing else — holding it
// would only put an unplayable file behind a recovery banner.
export const MIN_RECORDING_BYTES = 1000;

// A whole-file mean RMS is diluted by pauses, so real speech reads as silent.
// We look at the loudest ~1s window instead: if any second reaches speech-level
// energy, the recording is not silent. Both signals must agree before we skip
// transcription — a false skip loses data, a false pass merely costs one API
// round-trip that returns empty.
export const SPEECH_WINDOW_RMS  = 0.02;  // loudest ~1s window must reach this to be "speech"
export const SILENCE_PEAK_FLOOR = 0.05;  // ...and no sample exceeds this → truly silent

// An unmeasurable recording (decode failed, or measurement was skipped) is
// never silent — we cannot prove anything about it, so it goes to the server.
export function isSilent(
  { loudestWindowRms, peak } = {},
  { speechWindowRms = SPEECH_WINDOW_RMS, silencePeakFloor = SILENCE_PEAK_FLOOR } = {},
) {
  if (typeof loudestWindowRms !== 'number') return false;
  return loudestWindowRms < speechWindowRms && (peak ?? 0) < silencePeakFloor;
}

// Closing the modal is NOT a discard. The audio is deleted in exactly two
// places — a successful save (which clears it itself) and an explicit Discard
// on the recovery banner — so everything else hands the recording to the banner
// rather than destroying it. `transcribeFailed` is deliberately not consulted:
// the previous rule keyed on it and silently deleted every recording whose
// transcription had *succeeded* without the session being saved.
export function shouldClearHeldAudioOnClose({ saved }) {
  return saved === true;
}

// Runs the post-stop sequence. `hold`, `measure` and `transcribe` are injected
// so the ordering can be tested without a browser.
//
// Returns { outcome: 'too-short' | 'silent' | 'transcribing', held, measurement }.
export async function finishRecording({ blob, mimeType, seconds }, { hold, measure, transcribe }) {
  const size = blob?.size ?? 0;
  if (size < MIN_RECORDING_BYTES) return { outcome: 'too-short', held: false, size };

  // Hold FIRST — before measuring, before uploading, before anything that can
  // fail or judge the recording. Everything below this line is allowed to go
  // wrong without costing the user the session.
  let held = true;
  try {
    await hold({ blob, mimeType, seconds });
  } catch {
    // Best-effort: private windows and blocked site data throw. A failed cache
    // must never take down the recording flow itself.
    held = false;
  }

  let measurement;
  try {
    measurement = await measure(blob);
  } catch {
    measurement = { loudestWindowRms: null, peak: 0 }; // let the server decide
  }

  if (isSilent(measurement)) return { outcome: 'silent', held, measurement };

  await transcribe();
  return { outcome: 'transcribing', held, measurement };
}
