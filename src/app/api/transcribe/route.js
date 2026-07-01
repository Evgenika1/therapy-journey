import { NextResponse } from 'next/server';

export const maxDuration = 300; // 5 minutes — needed for long recordings

const API_KEY = process.env.ASSEMBLYAI_API_KEY;
const HEADERS = { authorization: API_KEY, 'content-type': 'application/json' };

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
        return NextResponse.json({ error: transcript.error }, { status: 500 });
      }
    }

    if (!transcript || transcript.status !== 'completed') {
      return NextResponse.json({ error: 'Transcription timed out' }, { status: 500 });
    }

    console.log('[transcribe] done. language:', transcript.language_code, 'text:', transcript.text?.slice(0, 200));
    return NextResponse.json({
      text: transcript.text || '',
      utterances: transcript.utterances || [],
      language_code: transcript.language_code || null,
    });
  } catch (err) {
    console.error('[transcribe]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
