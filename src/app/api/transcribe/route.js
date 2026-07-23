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

    const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        audio_url: upload_url,
        language_code: langCode,
        // Fix 2: reject audio that is less than 40% speech — AssemblyAI's
        // built-in guard against transcribing (and hallucinating on) silence.
        speech_threshold: 0.4,
      }),
    });
    if (!transcriptRes.ok) {
      const err = await transcriptRes.text();
      return NextResponse.json({ error: `Transcript create failed: ${err}` }, { status: 500 });
    }
    const { id } = await transcriptRes.json();
    console.log('[transcribe] job created, id:', id);

    // 3. Poll until completed
    let transcript;
    for (let i = 0; i < 150; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, { headers: HEADERS });
      transcript = await pollRes.json();
      console.log('[transcribe] poll', i, 'status:', transcript.status, 'text_length:', transcript.text?.length ?? 0);
      if (transcript.status === 'completed') break;
      if (transcript.status === 'error') {
        // Fix 2: speech_threshold rejection means "not enough speech" — treat as
        // no-speech (empty), not a hard error, so the UI degrades gracefully.
        const msg = (transcript.error || '').toLowerCase();
        if (msg.includes('speech') || msg.includes('threshold') || msg.includes('audio duration')) {
          console.log('[transcribe] rejected (insufficient speech):', transcript.error);
          return NextResponse.json({ text: '', utterances: [], language_code: null, noSpeech: true });
        }
        return NextResponse.json({ error: transcript.error }, { status: 500 });
      }
    }

    if (!transcript || transcript.status !== 'completed') {
      return NextResponse.json({ error: 'Transcription timed out' }, { status: 500 });
    }

    // Fix 3: strip any hallucination boilerplate that still slipped through
    const cleanText = stripHallucinations(transcript.text || '');
    console.log('[transcribe] done. language:', transcript.language_code,
      'raw_len:', transcript.text?.length ?? 0, 'clean_len:', cleanText.length,
      'text:', cleanText.slice(0, 200));
    return NextResponse.json({
      text: cleanText,
      utterances: transcript.utterances || [],
      language_code: transcript.language_code || null,
    });
  } catch (err) {
    console.error('[transcribe]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
