// Critical path, async half: upload → job id → poll → transcript.
//
// The transcription flow was a single request that held the connection open
// until AssemblyAI finished. No serverless platform allows that for a 90-minute
// recording, so it is now create-job + poll. These tests pin the contract of the
// polling loop and the server-side retry rules, both of which decide whether a
// real session survives or is lost.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pollTranscript, TranscribeError, POLL_TIMEOUT_MS } from '../src/lib/transcribeClient.js';
import {
  shouldRetryForcedRu, isNoSpeech, completedPayload,
  TRANSCRIBE_CONFIG, FORCED_RU_CONFIG, AAI_BASE,
} from '../src/lib/transcribeJob.js';

// A fake server: each entry is one status response, consumed in order.
function fakeStatus(responses) {
  const seen = [];
  const impl = async (url) => {
    seen.push(url);
    const body = responses.shift();
    if (!body) throw new Error('fake server ran out of responses');
    if (body.__throw) throw new Error(body.__throw);
    return { ok: body.__httpOk !== false, status: body.__status ?? 200, json: async () => body };
  };
  return { impl, seen };
}

const opts = (impl, extra = {}) => ({
  fetchImpl: impl,
  sleep: async () => {},           // no real waiting in tests
  intervalMs: 0,
  ...extra,
});

// ── polling loop ─────────────────────────────────────────────────────────────

test('polls until the job completes and returns the transcript', async () => {
  const { impl, seen } = fakeStatus([
    { status: 'processing' },
    { status: 'processing' },
    { status: 'completed', text: '[A 0:15] Мне тревожно.', utterances: [{ speaker: 'A' }], language_code: 'ru' },
  ]);
  const out = await pollTranscript('job-1', opts(impl));
  assert.equal(out.text, '[A 0:15] Мне тревожно.');
  assert.equal(out.language_code, 'ru');
  assert.equal(out.noSpeech, false);
  assert.equal(seen.length, 3);
  assert.ok(seen[0].includes('job_id=job-1'));
});

test('follows the job id when the server starts a forced-Russian retry', async () => {
  // The old sync route retried internally; now the retry produces a new job and
  // the client must switch to it, flagging `retried` so it cannot loop forever.
  const { impl, seen } = fakeStatus([
    { status: 'processing' },
    { status: 'processing', job_id: 'job-2', retried: true },
    { status: 'processing' },
    { status: 'completed', text: 'русский текст', language_code: 'ru' },
  ]);
  const out = await pollTranscript('job-1', opts(impl));
  assert.equal(out.text, 'русский текст');
  assert.ok(seen[1].includes('job_id=job-1'), 'second poll still on the original job');
  assert.ok(seen[2].includes('job_id=job-2'), 'third poll must follow the retry job');
  assert.ok(seen[2].includes('retried=1'), 'must tell the server a retry already happened');
  assert.ok(seen[3].includes('retried=1'));
});

test('a transient network failure keeps polling instead of losing the job', async () => {
  // The job runs on AssemblyAI regardless of whether one poll reached us — a
  // dropped request must not be reported as a failed transcription.
  const { impl } = fakeStatus([
    { __throw: 'network down' },
    { status: 'processing' },
    { status: 'completed', text: 'готово' },
  ]);
  const out = await pollTranscript('job-1', opts(impl));
  assert.equal(out.text, 'готово');
});

test('an errored job is reported with its reason', async () => {
  const { impl } = fakeStatus([{ status: 'error', error: 'Transcoding failed' }]);
  await assert.rejects(() => pollTranscript('job-1', opts(impl)), err => {
    assert.ok(err instanceof TranscribeError);
    assert.match(err.message, /Transcoding failed/);
    return true;
  });
});

test('a silent recording completes with noSpeech rather than erroring', async () => {
  const { impl } = fakeStatus([
    { status: 'completed', text: '', utterances: [], language_code: null, noSpeech: true },
  ]);
  const out = await pollTranscript('job-1', opts(impl));
  assert.equal(out.text, '');
  assert.equal(out.noSpeech, true);
});

test('polling gives up after the timeout with an actionable message', async () => {
  let clock = 0;
  const { impl } = fakeStatus(Array.from({ length: 50 }, () => ({ status: 'processing' })));
  await assert.rejects(
    () => pollTranscript('job-1', opts(impl, { now: () => (clock += 60_000), timeoutMs: 120_000 })),
    /не завершилась за отведённое время|Запись сохранена/,
  );
});

test('cancellation stops the loop', async () => {
  const { impl } = fakeStatus(Array.from({ length: 10 }, () => ({ status: 'processing' })));
  let ticks = 0;
  await assert.rejects(
    () => pollTranscript('job-1', opts(impl, { isCancelled: () => ++ticks > 3 })),
    /отменена/,
  );
});

test('a missing job id fails immediately instead of polling nothing', async () => {
  await assert.rejects(() => pollTranscript(undefined, opts(async () => {
    throw new Error('should never be called');
  })), /идентификатора/);
});

test('the client timeout is generous enough for a long session', () => {
  // It is a browser-side wall clock, not a function limit — a 90-minute
  // recording legitimately takes many minutes to transcode and diarize.
  assert.ok(POLL_TIMEOUT_MS >= 20 * 60 * 1000);
});

// ── server-side job rules ────────────────────────────────────────────────────

test('language-detection and transcoding failures trigger the forced-ru retry', () => {
  assert.equal(shouldRetryForcedRu({ error: 'Language detection failed' }), true);
  assert.equal(shouldRetryForcedRu({ error: 'detected language confidence below threshold' }), true);
  assert.equal(shouldRetryForcedRu({ error: 'Transcoding failed' }), true);
  assert.equal(shouldRetryForcedRu({ error: 'unsupported media format' }), true);
});

test('unrelated failures are not retried', () => {
  assert.equal(shouldRetryForcedRu({ error: 'Upload not found' }), false);
  assert.equal(shouldRetryForcedRu({ error: '' }), false);
  assert.equal(shouldRetryForcedRu({}), false);
});

test('a not-enough-speech rejection is treated as an empty transcript, not an error', () => {
  assert.equal(isNoSpeech({ error: 'Audio duration is too short' }), true);
  assert.equal(isNoSpeech({ error: 'speech_threshold not met' }), true);
  assert.equal(isNoSpeech({ error: 'Transcoding failed' }), false);
});

test('a completed job is shaped into diarized blocks', () => {
  const payload = completedPayload({
    status: 'completed',
    language_code: 'ru',
    utterances: [
      { speaker: 'A', start: 15000, text: 'Мне тревожно. Спасибо за просмотр.' },
      { speaker: 'B', start: 22000, text: 'Расскажите.' },
    ],
  });
  assert.equal(payload.status, 'completed');
  assert.equal(payload.text, '[A 0:15] Мне тревожно.\n\n[B 0:22] Расскажите.');
  assert.equal(payload.language_code, 'ru');
});

test('a completed job with no utterances falls back to flat text', () => {
  const payload = completedPayload({ status: 'completed', utterances: [], text: 'плоский текст.' });
  assert.equal(payload.text, 'плоский текст.');
});

test('both upload routes request diarization; only the retry forces a language', () => {
  assert.equal(TRANSCRIBE_CONFIG.speaker_labels, true);
  assert.equal(TRANSCRIBE_CONFIG.language_detection, true);
  assert.ok(!('language_code' in TRANSCRIBE_CONFIG), 'first attempt must auto-detect');
  assert.equal(FORCED_RU_CONFIG.language_code, 'ru');
  assert.equal(FORCED_RU_CONFIG.speaker_labels, true);
  assert.ok(!FORCED_RU_CONFIG.language_detection, 'the retry must not re-detect');
});

test('audio stays in the EU region', () => {
  // GDPR: therapy audio is health data.
  assert.equal(AAI_BASE, 'https://api.eu.assemblyai.com');
});

// ── deployment ceiling ───────────────────────────────────────────────────────

test('no route declares a maxDuration above what Vercel allows', async () => {
  // Vercel: Hobby 300s max, Pro/Enterprise 800s (1800s on the extended beta).
  // Two routes shipped `maxDuration = 3600`, which is above every plan's
  // ceiling — the reason the whole poll-to-completion design had to go.
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const routes = [];
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (e === 'route.js') routes.push(full);
    }
  })('src/app/api');

  assert.ok(routes.length > 0, 'expected to find API routes');
  for (const file of routes) {
    const m = readFileSync(file, 'utf8').match(/export const maxDuration\s*=\s*(\d+)/);
    if (!m) continue;
    assert.ok(Number(m[1]) <= 300,
      `${file} declares maxDuration=${m[1]}, above Vercel Hobby's 300s limit`);
  }
});

test('an HTTP failure from the status route stops the loop instead of polling forever', async () => {
  // AssemblyAI answers an unknown/expired job id with HTTP 400 and a body that
  // has an `error` key but NO `status`. A status route that only branches on
  // transcript.status treats that as "processing", so a dead job would be
  // polled until the client timeout — 40 minutes of a spinner for what is
  // really a bad id or a rejected API key.
  const { impl } = fakeStatus([
    { __httpOk: false, __status: 502, error: 'Status check failed (400): transcript id not found' },
  ]);
  await assert.rejects(() => pollTranscript('bogus', opts(impl)), err => {
    assert.ok(err instanceof TranscribeError);
    assert.match(err.message, /transcript id not found/);
    return true;
  });
});

// ── resuming a job across a reload ───────────────────────────────────────────

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    _size: () => map.size,
  };
}

test('a job id survives a reload so the upload is not repeated', async () => {
  const { rememberPendingJob, loadPendingJob } =
    await import('../src/lib/transcribeClient.js');
  const storage = fakeStorage();
  rememberPendingJob('job-1', { storage, now: () => 1000 });
  assert.equal(loadPendingJob({ storage, now: () => 5000 }), 'job-1');
});

test('a settled job is forgotten', async () => {
  const { rememberPendingJob, forgetPendingJob, loadPendingJob } =
    await import('../src/lib/transcribeClient.js');
  const storage = fakeStorage();
  rememberPendingJob('job-1', { storage, now: () => 1000 });
  forgetPendingJob({ storage });
  assert.equal(loadPendingJob({ storage, now: () => 2000 }), null);
  assert.equal(storage._size(), 0);
});

test('a stale job id is dropped instead of polled for the full timeout', async () => {
  const { rememberPendingJob, loadPendingJob, PENDING_JOB_TTL_MS } =
    await import('../src/lib/transcribeClient.js');
  const storage = fakeStorage();
  rememberPendingJob('old-job', { storage, now: () => 0 });
  assert.equal(loadPendingJob({ storage, now: () => PENDING_JOB_TTL_MS + 1 }), null);
  assert.equal(storage._size(), 0, 'the stale entry must be cleared, not left to retry every load');
});

test('a corrupted entry is cleared rather than resumed', async () => {
  const { loadPendingJob, PENDING_JOB_KEY } = await import('../src/lib/transcribeClient.js');
  for (const bad of ['not json', '{}', '{"jobId":"x"}', '{"startedAt":1}', 'null']) {
    const storage = fakeStorage({ [PENDING_JOB_KEY]: bad });
    assert.equal(loadPendingJob({ storage, now: () => 1 }), null, `should reject: ${bad}`);
    assert.equal(storage._size(), 0, `should clear: ${bad}`);
  }
});

test('no stored job means nothing to resume', async () => {
  const { loadPendingJob } = await import('../src/lib/transcribeClient.js');
  assert.equal(loadPendingJob({ storage: fakeStorage(), now: () => 1 }), null);
});

test('storage being unavailable never breaks the flow', async () => {
  const { rememberPendingJob, forgetPendingJob, loadPendingJob } =
    await import('../src/lib/transcribeClient.js');
  // Private windows throw on access rather than returning null.
  const hostile = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  assert.doesNotThrow(() => rememberPendingJob('job-1', { storage: hostile }));
  assert.doesNotThrow(() => forgetPendingJob({ storage: hostile }));
  assert.equal(loadPendingJob({ storage: hostile }), null);
  assert.equal(loadPendingJob({ storage: null }), null);
});
