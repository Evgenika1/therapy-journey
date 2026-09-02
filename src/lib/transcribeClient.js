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
} = {}) {
  if (!jobId) throw new TranscribeError('нет идентификатора задачи транскрипции');

  let currentJob = jobId;
  let retried = false;
  const startedAt = now();

  for (;;) {
    if (isCancelled()) throw new TranscribeError('расшифровка отменена');
    if (now() - startedAt > timeoutMs) {
      throw new TranscribeError('расшифровка не завершилась за отведённое время. Запись сохранена — попробуйте ещё раз.');
    }

    await sleep(intervalMs);
    if (isCancelled()) throw new TranscribeError('расшифровка отменена');

    let body;
    try {
      const res = await fetchImpl(
        `/api/transcribe/status?job_id=${encodeURIComponent(currentJob)}${retried ? '&retried=1' : ''}`);
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
    if (body.status === 'error') throw new TranscribeError(body.error || 'расшифровка не удалась');

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
 * POST a blob or File as a raw binary body and return the created job id.
 * XHR rather than fetch so upload progress is real — a long session takes
 * minutes just to reach the server.
 */
export function uploadForTranscription(url, body, { filename, contentType, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', contentType || 'application/octet-stream');
    if (filename) xhr.setRequestHeader('X-Filename', encodeURIComponent(filename));
    xhr.upload.onprogress = ev => {
      if (ev.lengthComputable && onProgress) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      let parsed; try { parsed = JSON.parse(xhr.responseText); } catch { parsed = {}; }
      if (xhr.status >= 200 && xhr.status < 300 && !parsed.error) resolve(parsed);
      else reject(new TranscribeError(parsed.error || `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new TranscribeError('соединение с сервером оборвалось'));
    xhr.send(body);
  });
}
