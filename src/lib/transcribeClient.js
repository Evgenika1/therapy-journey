import { Upload as TusUpload } from 'tus-js-client';
import { resumableUploadOptions, uploadPercent } from './audioStorage.js';

// Client half of the async transcription flow: upload returns a job id, this
// polls /api/transcribe/status until the job finishes.
//
// The polling lives here rather than in the page so both entry points — a live
// recording and an imported file — share one implementation, and so the loop
// (retry hand-off, timeout, cancellation) can be tested without a browser.

export const POLL_INTERVAL_MS = 3000;
// A 90-minute recording takes several minutes to transcode and diarize. This is
// a client-side wall clock, not a serverless function limit, so it can be
// generous — the job keeps running on AssemblyAI regardless.
export const POLL_TIMEOUT_MS = 40 * 60 * 1000;

export class TranscribeError extends Error {}

/**
 * Poll a transcription job to completion.
 *
 * @returns {Promise<{text: string, utterances: array, language_code: string|null, noSpeech: boolean}>}
 * @throws {TranscribeError} on a failed job, a timeout, or cancellation.
 */
export async function pollTranscript(jobId, {
  intervalMs = POLL_INTERVAL_MS,
  timeoutMs  = POLL_TIMEOUT_MS,
  fetchImpl  = (...a) => fetch(...a),
  sleep      = ms => new Promise(r => setTimeout(r, ms)),
  now        = () => Date.now(),
  isCancelled = () => false,
  onProgress = () => {},
  // Where the audio waits in Supabase Storage. Sent on every poll so the status
  // route can delete the file the moment the job settles.
  audioPath  = null,
} = {}) {
  if (!jobId) throw new TranscribeError('no transcription job id');

  let currentJob = jobId;
  let retried = false;
  const startedAt = now();

  for (;;) {
    if (isCancelled()) throw new TranscribeError('transcription cancelled');
    if (now() - startedAt > timeoutMs) {
      throw new TranscribeError('transcription did not finish in time. The recording is saved — try again.');
    }

    await sleep(intervalMs);
    if (isCancelled()) throw new TranscribeError('transcription cancelled');

    let body;
    try {
      const res = await fetchImpl(
        `/api/transcribe/status?job_id=${encodeURIComponent(currentJob)}${retried ? '&retried=1' : ''}`
        + (audioPath ? `&path=${encodeURIComponent(audioPath)}` : ''));
      body = await res.json();
      if (!res.ok && !body?.status) throw new TranscribeError(body?.error || `HTTP ${res.status}`);
    } catch (err) {
      if (err instanceof TranscribeError) throw err;
      // A dropped poll is not a dropped job — the transcription continues on
      // AssemblyAI, so keep polling instead of discarding the recording.
      console.warn('[transcribe] poll failed, retrying:', err?.message);
      onProgress({ status: 'processing', transient: true });
      continue;
    }

    if (body.error && !body.status) throw new TranscribeError(body.error);

    if (body.status === 'completed') {
      return {
        text: body.text || '',
        utterances: body.utterances || [],
        language_code: body.language_code ?? null,
        noSpeech: !!body.noSpeech,
      };
    }
    if (body.status === 'error') throw new TranscribeError(body.error || 'transcription failed');

    // Still processing. The server may have started a forced-Russian retry and
    // handed back a different job id — follow it.
    if (body.job_id && body.job_id !== currentJob) {
      currentJob = body.job_id;
      retried = true;
    } else if (body.retried) {
      retried = true;
    }
    onProgress({ status: 'processing', retried });
  }
}

/**
 * Upload a recording into Supabase Storage, resumably.
 *
 * The audio used to be POSTed to our own API route, but a Vercel function
 * rejects any request body over 4.5 MB (FUNCTION_PAYLOAD_TOO_LARGE) — a few
 * minutes of speech. It then went up in a single POST straight to Storage,
 * which cleared that limit but still lost the whole upload to one dropped
 * connection: minutes of a 24 MB file, gone, with "Transcription failed" as the
 * only explanation.
 *
 * Now it goes up in 6 MB chunks over the resumable (tus) protocol: a drop costs
 * one chunk, the client retries on a growing delay, and a reload can pick up
 * where it left off. Options live in audioStorage.js so they can be tested.
 */
export function uploadToStorage({ supabaseUrl, anonKey, accessToken, path, body, contentType, onProgress }) {
  return new Promise((resolve, reject) => {
    const upload = new TusUpload(body, {
      ...resumableUploadOptions({ supabaseUrl, accessToken, anonKey, path, contentType }),
      onProgress: (sent, total) => { if (onProgress) onProgress(uploadPercent(sent, total)); },
      onSuccess: () => resolve(),
      onError: err => reject(new TranscribeError(
        `upload failed: ${err?.originalResponse?.getBody?.() || err?.message || 'the connection dropped'}`)),
    });
    // Resume rather than restart when this exact file was already part-uploaded.
    upload.findPreviousUploads()
      .then(previous => { if (previous.length) upload.resumeFromPreviousUpload(previous[0]); upload.start(); })
      .catch(() => upload.start());
  });
}

/**
 * Ask the server to transcribe audio already in Storage. Only the path and the
 * original file name travel — a few bytes, far under any function body limit.
 */
export async function startTranscription(url, { path, filename }, { fetchImpl = (...a) => fetch(...a) } = {}) {
  let res, body;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filename ? { path, filename } : { path }),
    });
    body = await res.json();
  } catch (err) {
    throw new TranscribeError(err instanceof TranscribeError ? err.message : 'the connection to the server dropped');
  }
  if (!res.ok || body?.error || !body?.job_id) throw new TranscribeError(body?.error || `HTTP ${res.status}`);
  return body;
}

// ── resuming across a reload ──────────────────────────────────────────────────
//
// The upload is the expensive half — minutes for a long session. Once the job
// exists it runs on AssemblyAI whether or not this tab is alive, so remembering
// the id lets a reload rejoin the same job instead of re-uploading. The audio
// stays in IndexedDB either way, so a dead job still falls back to the recovery
// banner rather than losing the recording.

export const PENDING_JOB_KEY = 'miru_pending_transcribe_job';

// Nothing outlives the polling window: an id older than this belongs to a job
// that finished or expired long ago, and resuming it would spin for the full
// timeout for nothing.
export const PENDING_JOB_TTL_MS = POLL_TIMEOUT_MS;

export function rememberPendingJob(jobId, { storage = safeStorage(), now = Date.now, audioPath = null } = {}) {
  if (!jobId || !storage) return;
  const entry = audioPath ? { jobId, startedAt: now(), audioPath } : { jobId, startedAt: now() };
  try { storage.setItem(PENDING_JOB_KEY, JSON.stringify(entry)); } catch {}
}

export function forgetPendingJob({ storage = safeStorage() } = {}) {
  if (!storage) return;
  try { storage.removeItem(PENDING_JOB_KEY); } catch {}
}

// Returns the job id to resume, or null. A malformed or stale entry is cleared
// rather than left to be retried on every future load.
export function loadPendingJob({ storage = safeStorage(), now = Date.now, ttlMs = PENDING_JOB_TTL_MS } = {}) {
  if (!storage) return null;
  let raw;
  try { raw = storage.getItem(PENDING_JOB_KEY); } catch { return null; }
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { forgetPendingJob({ storage }); return null; }
  if (!parsed?.jobId || typeof parsed.startedAt !== 'number') { forgetPendingJob({ storage }); return null; }
  if (now() - parsed.startedAt > ttlMs) { forgetPendingJob({ storage }); return null; }
  return parsed.jobId;
}

// The Storage path of the resumed job's audio, so the rejoined poll can still
// have the file deleted. Read after loadPendingJob has vetted the entry.
export function loadPendingAudioPath({ storage = safeStorage() } = {}) {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(PENDING_JOB_KEY));
    return typeof parsed?.audioPath === 'string' ? parsed.audioPath : null;
  } catch { return null; }
}

// localStorage throws outright in some privacy modes — never take down the
// recording flow over a cache convenience.
function safeStorage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
