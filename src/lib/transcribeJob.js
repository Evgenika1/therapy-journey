// Shared AssemblyAI job configuration and result shaping for the async
// transcription flow (create job → poll status), used by /api/transcribe,
// /api/transcribe-file and /api/transcribe/status.
//
// Both upload routes create the job the same way and the single status route
// interprets it, so the retry rules and the "not enough speech" handling exist
// once rather than once per route.

import { formatUtterances } from './transcriptFormat.js';

// GDPR: session audio is health data, so it is processed in the EU region for
// BOTH upload and transcript. Nothing persists an AssemblyAI transcript id
// beyond one polling session (Supabase stores the finished text), so the region
// can be switched without stranding any existing session.
export const AAI_BASE = 'https://api.eu.assemblyai.com';

export const AAI_HEADERS = () => ({
  authorization: process.env.ASSEMBLYAI_API_KEY,
  'content-type': 'application/json',
});

// language_confidence_threshold makes AssemblyAI error out when it cannot
// confidently detect a language, which is what triggers the forced-Russian
// retry below rather than letting it guess wrong.
export const TRANSCRIBE_CONFIG = {
  // Speaker diarization — returns per-speaker `utterances` so the transcript can
  // be rendered as a dialogue instead of one paragraph.
  speaker_labels: true,
  language_detection: true,
  language_confidence_threshold: 0.4,
};

// Config for the second attempt: the app's primary language, detection off.
export const FORCED_RU_CONFIG = { speaker_labels: true, language_code: 'ru' };

const lower = t => (t?.error || '').toLowerCase();

// Worth a second attempt with forced Russian: auto-detect gave up, or the
// intermittent transcoding failure on MediaRecorder's streamed WebM.
export function shouldRetryForcedRu(transcript) {
  const msg = lower(transcript);
  return msg.includes('language') || msg.includes('detect') || msg.includes('confidence')
      || msg.includes('transcoding') || msg.includes('unsupported');
}

// A speech_threshold rejection means "not enough speech", not a hard failure —
// the UI degrades to an empty transcript the user can type into, instead of
// showing an error for a recording that simply had nothing in it.
export function isNoSpeech(transcript) {
  const msg = lower(transcript);
  return msg.includes('speech') || msg.includes('threshold') || msg.includes('audio duration');
}

// Shape a completed AssemblyAI transcript into the response the client renders.
export function completedPayload(transcript) {
  const utterances = transcript.utterances || [];
  const text = formatUtterances(utterances, transcript.text);
  return { status: 'completed', text, utterances, language_code: transcript.language_code || null };
}
