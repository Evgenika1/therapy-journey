import { NextResponse } from 'next/server';
import { aaiFetch, uploadAudio } from '@/lib/assemblyai';
import { MAX_UPLOAD_BYTES, fmtSize, tooLargeMessage } from '@/lib/audioUpload';

// A 91-minute session is a ~25-minute round trip on a slow uplink: upload +
// transcode + diarization. 300s cut that off well before it could finish.
export const maxDuration = 3600; // 1 hour

// GDPR: session audio is health data, so it is processed in the EU region for
// BOTH upload and transcript — same as /api/transcribe-file. Nothing persists an
// AssemblyAI transcript id (the id below is local to one polling loop; Supabase
// stores the finished text), so the region can be switched without stranding any
// existing session.
const AAI_BASE = 'https://api.eu.assemblyai.com';
const API_KEY = process.env.ASSEMBLYAI_API_KEY;
const HEADERS = { authorization: API_KEY, 'content-type': 'application/json' };

// Last-resort server-side filter for ASR hallucination boilerplate (subtitle
// credits) that speech models emit on near-silent audio.
const HALLUCINATION_PATTERNS = [
  /редактор\s+субтитров/i,
  /корректор\s+[А-ЯA-Z]\./i,
  /продолжение\s+следует/i,
  /субтитры?\s+(сделал|создавал|делал|подготовил|редактировал|правил)/i,
  /спасибо\s+за\s+просмотр/i,
  /подписывайтесь/i,
  /dimatorzok/i,
  /amara\.org/i,
  /thanks?\s+for\s+watching/i,
  /subtitles?\s+by/i,
  /please\s+subscribe/i,
];
function stripHallucinations(text) {
  if (!text) return '';
  return text
    .split(/(?<=[.!?\n])\s+/)
    .map(s => s.trim())
    .filter(s => s && !HALLUCINATION_PATTERNS.some(re => re.test(s)))
    .join(' ')
    .trim();
}

// One create-job + poll attempt against an already-uploaded audio_url. Returns a
// tagged result so the caller can decide whether to retry (e.g. on an
// intermittent transcoding failure) without re-running the whole POST.
// langConfig is spread into the request — either { language_detection: true, … }
// (auto-detect the spoken language) or { language_code: 'ru' } (forced fallback).
async function transcribeOnce(upload_url, langConfig) {
  const transcriptRes = await aaiFetch(`${AAI_BASE}/v2/transcript`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      audio_url: upload_url,
      // Speaker diarization — returns per-speaker `utterances` so the
      // transcript can be rendered as a dialogue instead of one paragraph.
      speaker_labels: true,
      ...langConfig,
    }),
  }, 'Создание транскрипта', 'transcribe');
  if (!transcriptRes.ok) {
    const err = await transcriptRes.text();
    return { kind: 'create_failed', error: `Transcript create failed: ${err}` };
  }
  const { id } = await transcriptRes.json();
  console.log('[transcribe] job created, id:', id);

  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await aaiFetch(`${AAI_BASE}/v2/transcript/${id}`, { headers: HEADERS }, 'Опрос статуса транскрипта', 'transcribe');
    const transcript = await pollRes.json();
    console.log('[transcribe] poll', i, 'status:', transcript.status, 'text_length:', transcript.text?.length ?? 0);
    if (transcript.status === 'completed') return { kind: 'completed', transcript };
    if (transcript.status === 'error')     return { kind: 'error', transcript };
  }
  return { kind: 'timeout' };
}

export async function POST(req) {
  try {
    // RAW binary body, not multipart/form-data — same approach as
    // /api/transcribe-file. It skips the flaky multipart layer in this
    // Next/Turbopack setup, avoids a second full copy of an 85 MB buffer in
    // memory, and matches how we forward the bytes to AssemblyAI anyway.
    const declared = Number(req.headers.get('content-length')) || 0;
    const filename = decodeURIComponent(req.headers.get('x-filename') || 'recording.webm');
    console.log('[transcribe] name:', filename, 'content-length:', declared, `(${fmtSize(declared)})`);
    if (declared > MAX_UPLOAD_BYTES) {
      console.warn('[transcribe] rejected up front: over', MAX_UPLOAD_BYTES, 'bytes');
      return NextResponse.json({ error: tooLargeMessage(declared, 'webm') }, { status: 413 });
    }

    // 1. Upload audio to AssemblyAI (retries transport failures — a long upload
    //    over a weak uplink is exactly what died here with EPIPE).
    const audioBuffer = Buffer.from(await req.arrayBuffer());
    if (audioBuffer.length === 0) return NextResponse.json({ error: 'Empty recording' }, { status: 400 });
    console.log('[transcribe] received:', audioBuffer.length, 'bytes');
    const upload_url = await uploadAudio(AAI_BASE, API_KEY, audioBuffer, { tag: 'transcribe' });

    // 2 + 3. Create + poll. Auto-detect the spoken language (users record in
    // different languages; forcing 'ru' on non-Russian audio made AssemblyAI
    // hallucinate Russian). language_confidence_threshold makes AssemblyAI error
    // out when it can't confidently detect a language, so we fall back to forced
    // Russian — the app's primary language. The same retry also recovers the
    // intermittent transcoding failure on MediaRecorder's streamed WebM.
    let result = await transcribeOnce(upload_url, {
      language_detection: true,
      language_confidence_threshold: 0.4,
    });
    if (result.kind === 'error') {
      const msg = (result.transcript.error || '').toLowerCase();
      const detectFailed = msg.includes('language') || msg.includes('detect') || msg.includes('confidence');
      const transcodingFailed = msg.includes('transcoding') || msg.includes('unsupported');
      if (detectFailed || transcodingFailed) {
        console.log('[transcribe] auto-detect/transcoding failed, retrying with forced ru:', result.transcript.error);
        result = await transcribeOnce(upload_url, { language_code: 'ru' });
      }
    }

    if (result.kind === 'create_failed') {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    if (result.kind === 'timeout') {
      return NextResponse.json({ error: 'Transcription timed out' }, { status: 500 });
    }
    if (result.kind === 'error') {
      // Fix 2: speech_threshold rejection means "not enough speech" — treat as
      // no-speech (empty), not a hard error, so the UI degrades gracefully.
      const msg = (result.transcript.error || '').toLowerCase();
      if (msg.includes('speech') || msg.includes('threshold') || msg.includes('audio duration')) {
        console.log('[transcribe] rejected (insufficient speech):', result.transcript.error);
        return NextResponse.json({ text: '', utterances: [], language_code: null, noSpeech: true });
      }
      return NextResponse.json({ error: result.transcript.error }, { status: 500 });
    }
    const transcript = result.transcript; // kind === 'completed'

    // Diarization: format each utterance as a "[<speaker> <m:ss>] text" block so
    // the client can render per-utterance timestamped dialogue turns. Hallucination
    // boilerplate is stripped PER-UTTERANCE so the block separators (\n\n) survive
    // (stripHallucinations collapses newlines). Fall back to flat text when
    // diarization produced no utterances (short/near-silent audio).
    const utterances = transcript.utterances || [];
    const fmtMs = ms => { const s = Math.floor((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    let cleanText;
    if (utterances.length > 0) {
      cleanText = utterances
        .map(u => {
          const t = stripHallucinations(u.text || '');
          return t ? `[${u.speaker} ${fmtMs(u.start)}] ${t}` : '';
        })
        .filter(Boolean)
        .join('\n\n');
    } else {
      cleanText = stripHallucinations(transcript.text || '');
    }
    console.log('[transcribe] done. language:', transcript.language_code,
      'raw_len:', transcript.text?.length ?? 0, 'clean_len:', cleanText.length,
      'utterances:', utterances.length, 'text:', cleanText.slice(0, 200));
    return NextResponse.json({
      text: cleanText,
      utterances,
      language_code: transcript.language_code || null,
    });
  } catch (err) {
    console.error('[transcribe]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
