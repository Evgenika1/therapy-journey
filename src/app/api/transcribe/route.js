import { NextResponse } from 'next/server';

export const maxDuration = 300; // 5 minutes — needed for long recordings

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
async function transcribeOnce(upload_url, langCode) {
  const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      audio_url: upload_url,
      language_code: langCode,
      // Speaker diarization — returns per-speaker `utterances` so the
      // transcript can be rendered as a dialogue instead of one paragraph.
      speaker_labels: true,
    }),
  });
  if (!transcriptRes.ok) {
    const err = await transcriptRes.text();
    return { kind: 'create_failed', error: `Transcript create failed: ${err}` };
  }
  const { id } = await transcriptRes.json();
  console.log('[transcribe] job created, id:', id);

  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, { headers: HEADERS });
    const transcript = await pollRes.json();
    console.log('[transcribe] poll', i, 'status:', transcript.status, 'text_length:', transcript.text?.length ?? 0);
    if (transcript.status === 'completed') return { kind: 'completed', transcript };
    if (transcript.status === 'error')     return { kind: 'error', transcript };
  }
  return { kind: 'timeout' };
}

export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get('audio');
    if (!file) return NextResponse.json({ error: 'No audio file' }, { status: 400 });

    // 1. Upload audio to AssemblyAI
    const audioBuffer = Buffer.from(await file.arrayBuffer());
    console.log('[transcribe] file size:', audioBuffer.length, 'bytes, name:', file.name);
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { authorization: API_KEY, 'content-type': 'application/octet-stream' },
      body: audioBuffer,
    });
    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return NextResponse.json({ error: `Upload failed: ${err}` }, { status: 500 });
    }
    const { upload_url } = await uploadRes.json();

    // 2. Create transcription job
    // Use browser language if provided, otherwise fall back to Russian (primary user language)
    const lang = formData.get('language') || 'ru';
    // AssemblyAI supported codes: en, ru, fr, de, es, it, pt, nl, hi, ja, zh, fi, ko, pl, uk
    const SUPPORTED = ['en','ru','fr','de','es','it','pt','nl','hi','ja','zh','fi','ko','pl','uk'];
    const langCode = SUPPORTED.includes(lang) ? lang : 'ru';
    console.log('[transcribe] language from browser:', lang, '→ using:', langCode);

    // 3. Create + poll, retrying ONCE on a transcoding failure. AssemblyAI's
    // transcoder intermittently fails to probe MediaRecorder's streamed WebM
    // containers ("File type application/octet-stream (data) … unsupported")
    // even for a valid-size blob; a second attempt on the same upload_url
    // recovers the transient case (and confirms a genuinely-bad container if it
    // fails again).
    let result = await transcribeOnce(upload_url, langCode);
    if (result.kind === 'error') {
      const msg = (result.transcript.error || '').toLowerCase();
      if (msg.includes('transcoding') || msg.includes('unsupported')) {
        console.log('[transcribe] transcoding failed, retrying once:', result.transcript.error);
        result = await transcribeOnce(upload_url, langCode);
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
