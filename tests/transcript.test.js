// Critical path: recording → transcript → what gets stored and rendered.
//
// The formatting layer between AssemblyAI's utterances and the saved transcript
// is where a session's text can silently turn into one unreadable paragraph, so
// the block structure ("[A 0:15] …\n\n[B 0:22] …") is asserted explicitly.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  stripHallucinations, parseSpeakerTurns, stripSpeakerMarkers,
  formatUtterances, detectSessionLang, groupSessions,
} from '../src/lib/transcriptFormat.js';
import {
  ALLOWED_EXT, MAX_UPLOAD_BYTES, extOf, tooLargeMessage, unsupportedTypeMessage,
} from '../src/lib/audioUpload.js';

// ── hallucination filter ─────────────────────────────────────────────────────

test('strips subtitle-credit boilerplate emitted on silence', () => {
  const raw = 'Я чувствую тревогу. Субтитры сделал DimaTorzok. Продолжение следует...';
  assert.equal(stripHallucinations(raw), 'Я чувствую тревогу.');
});

test('strips English ASR boilerplate too', () => {
  assert.equal(
    stripHallucinations('I was anxious. Thanks for watching! Please subscribe.'),
    'I was anxious.',
  );
});

test('keeps real speech untouched', () => {
  const real = 'Мне было страшно. Я не знал, что сказать.';
  assert.equal(stripHallucinations(real), real);
});

test('handles empty input without throwing', () => {
  assert.equal(stripHallucinations(''), '');
  assert.equal(stripHallucinations(null), '');
  assert.equal(stripHallucinations(undefined), '');
});

// ── utterance formatting (server side of the transcribe route) ───────────────

test('formats diarized utterances as separate timestamped blocks', () => {
  const out = formatUtterances([
    { speaker: 'A', start: 15000, text: 'Мне тревожно.' },
    { speaker: 'B', start: 22000, text: 'Расскажите подробнее.' },
  ], null);
  assert.equal(out, '[A 0:15] Мне тревожно.\n\n[B 0:22] Расскажите подробнее.');
});

test('block separators survive hallucination stripping', () => {
  // Regression: stripping the whole joined string collapses \n\n and turns a
  // dialogue into one paragraph. Stripping must happen per utterance.
  const out = formatUtterances([
    { speaker: 'A', start: 0,     text: 'Мне тревожно. Спасибо за просмотр.' },
    { speaker: 'B', start: 65000, text: 'Понимаю.' },
  ], null);
  assert.equal(out, '[A 0:00] Мне тревожно.\n\n[B 1:05] Понимаю.');
  assert.equal(out.split('\n\n').length, 2);
});

test('falls back to flat text when there are no utterances', () => {
  assert.equal(formatUtterances([], 'плоский текст.'), 'плоский текст.');
  assert.equal(formatUtterances(undefined, 'плоский текст.'), 'плоский текст.');
  assert.equal(formatUtterances([], ''), '');
});

test('drops utterances that were entirely boilerplate', () => {
  const out = formatUtterances([
    { speaker: 'A', start: 0,    text: 'Подписывайтесь на канал.' },
    { speaker: 'A', start: 5000, text: 'Настоящая речь.' },
  ], null);
  assert.equal(out, '[A 0:05] Настоящая речь.');
});

// ── speaker turn parsing (rendering side) ────────────────────────────────────

test('parses the timestamped diarized format into turns', () => {
  const parsed = parseSpeakerTurns('[A 0:15] Мне тревожно.\n\n[B 0:22] Расскажите.');
  assert.equal(parsed.turns.length, 2);
  assert.deepEqual(parsed.turns[0], { speaker: 'A', time: '0:15', text: 'Мне тревожно.' });
  assert.equal(parsed.multiSpeaker, true);
});

test('parses the legacy "Speaker A:" format without timestamps', () => {
  const parsed = parseSpeakerTurns('Speaker A: Мне тревожно.\n\nSpeaker B: Расскажите.');
  assert.equal(parsed.turns.length, 2);
  assert.equal(parsed.turns[0].time, null);
});

test('labels the most talkative speaker as the client', () => {
  const parsed = parseSpeakerTurns(
    '[A 0:00] ' + 'много слов '.repeat(20) + '\n\n[B 0:30] Угу.',
  );
  assert.equal(parsed.roleMap.A, 'Client');
  assert.equal(parsed.roleMap.B, 'Therapist');
});

test('returns null for a plain non-diarized transcript', () => {
  assert.equal(parseSpeakerTurns('Просто сплошной текст без разметки.'), null);
  assert.equal(parseSpeakerTurns(''), null);
  assert.equal(parseSpeakerTurns(null), null);
});

test('a hand-typed transcript renders as plain text, not as broken turns', () => {
  // Manual transcripts are the recovery path for a failed transcription; they
  // must never be mistaken for a half-parsed dialogue.
  assert.equal(parseSpeakerTurns('Первый абзац.\n\nВторой абзац.'), null);
});

// ── markers stripped before the text reaches Claude ──────────────────────────

test('timestamps are removed but speaker identity is kept for analysis', () => {
  assert.equal(
    stripSpeakerMarkers('[A 0:15] Мне тревожно.\n\n[B 0:22] Расскажите.'),
    'Speaker A: Мне тревожно.\n\nSpeaker B: Расскажите.',
  );
});

test('legacy transcripts pass through unchanged', () => {
  const legacy = 'Speaker A: Мне тревожно.\n\nSpeaker B: Расскажите.';
  assert.equal(stripSpeakerMarkers(legacy), legacy);
});

test('round trip: formatted utterances survive the trip to the analyser', () => {
  const stored = formatUtterances([
    { speaker: 'A', start: 15000, text: 'Мне тревожно.' },
    { speaker: 'B', start: 22000, text: 'Расскажите.' },
  ], null);
  const forClaude = stripSpeakerMarkers(stored);
  assert.ok(forClaude.includes('Мне тревожно.'));
  assert.ok(forClaude.includes('Расскажите.'));
  assert.ok(!/\d:\d\d/.test(forClaude), 'timestamps should be gone');
});

// ── language detection ───────────────────────────────────────────────────────

test('detects Russian despite Latin speaker prefixes', () => {
  const sessions = [{ transcript: 'Speaker A: Мне было очень тревожно на этой неделе.' }];
  assert.equal(detectSessionLang(sessions), 'ru');
});

test('detects English and defaults to English with no sessions', () => {
  assert.equal(detectSessionLang([{ transcript: 'I felt anxious all week.' }]), 'en');
  assert.equal(detectSessionLang([]), 'en');
  assert.equal(detectSessionLang(null), 'en');
});

// ── session grouping ─────────────────────────────────────────────────────────

test('groups sessions into today / this week / earlier', () => {
  const iso = daysAgo => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
  };
  const g = groupSessions([
    { id: 1, created_at: iso(0) },
    { id: 2, created_at: iso(3) },
    { id: 3, created_at: iso(40) },
  ]);
  assert.deepEqual(g.TODAY.map(s => s.id), [1]);
  assert.deepEqual(g.THIS_WEEK.map(s => s.id), [2]);
  assert.deepEqual(g.EARLIER.map(s => s.id), [3]);
});

// ── upload guards (shared by the browser and the transcribe routes) ──────────

test('accepts the supported audio containers and rejects others', () => {
  for (const ext of ['mp3', 'm4a', 'wav', 'mp4']) {
    assert.ok(ALLOWED_EXT.includes(ext));
  }
  assert.ok(!ALLOWED_EXT.includes('mov'));
  assert.match(unsupportedTypeMessage('mov'), /mp3, m4a, wav, mp4/);
});

test('extracts the extension case-insensitively', () => {
  assert.equal(extOf('Session Recording.M4A'), 'm4a');
  assert.equal(extOf('recording.webm'), 'webm');
});

test('the oversize message states the size and, for video, the ffmpeg fix', () => {
  const big = MAX_UPLOAD_BYTES + 1;
  assert.match(tooLargeMessage(big, 'mp3'), /слишком большой/);
  assert.match(tooLargeMessage(3 * 1024 ** 3, 'mp4'), /ffmpeg -i/);
  assert.match(tooLargeMessage(3 * 1024 ** 3, 'mp4'), /3\.00 ГБ/);
});

test('the upload ceiling stays below Nodes ~2 GiB request-body limit', () => {
  assert.ok(MAX_UPLOAD_BYTES < 2 * 1024 ** 3);
  assert.ok(MAX_UPLOAD_BYTES > 100 * 1024 * 1024, 'must still allow a long session');
});
