import { NextResponse } from 'next/server';

export const maxDuration = 300; // 5 minutes — long uploads + async transcription

// GDPR: use the AssemblyAI EU region for BOTH upload and transcript so audio and
// text stay in the EU. The API key is the same one used elsewhere in the app.
const AAI_BASE = 'https://api.eu.assemblyai.com';
const API_KEY = process.env.ASSEMBLYAI_API_KEY;

// Accept the common audio/video containers Zoom, voice recorders and phones emit.
const ALLOWED_EXT = ['mp3', 'm4a', 'wav', 'mp4'];

export async function POST(req) {
  if (!API_KEY) {
    return NextResponse.json({ error: 'ASSEMBLYAI_API_KEY not configured' }, { status: 500 });
  }
  try {
    // We take the file as a RAW binary body (not multipart/form-data) with the
    // filename in the X-Filename header. Multipart parsing via req.formData() was
    // failing in this Next/Turbopack setup ("Failed to parse body as FormData");
    // reading the raw body sidesteps that whole layer and matches how we forward
    // the bytes to AssemblyAI (octet-stream) anyway.
    const filename = decodeURIComponent(req.headers.get('x-filename') || 'audio');
    const ext = filename.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type ".${ext}". Allowed: ${ALLOWED_EXT.join(', ')}` },
        { status: 400 });
    }

    // 1. Upload the audio to AssemblyAI (EU).
    const audioBuffer = Buffer.from(await req.arrayBuffer());
    if (audioBuffer.length === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 });
    console.log('[transcribe-file] name:', filename, 'size:', audioBuffer.length, 'bytes');
    const uploadRes = await fetch(`${AAI_BASE}/v2/upload`, {
      method: 'POST',
      headers: { authorization: API_KEY, 'content-type': 'application/octet-stream' },
      body: audioBuffer,
    });
    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return NextResponse.json({ error: `Upload failed: ${err}` }, { status: 500 });
    }
    const { upload_url } = await uploadRes.json();

    // 2. Create the transcription job (auto language detection + speaker labels).
    const createRes = await fetch(`${AAI_BASE}/v2/transcript`, {
      method: 'POST',
      headers: { authorization: API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        audio_url: upload_url,
        language_detection: true,
        speaker_labels: true,
      }),
    });
    if (!createRes.ok) {
      const err = await createRes.text();
      return NextResponse.json({ error: `Transcript create failed: ${err}` }, { status: 500 });
    }
    const { id } = await createRes.json();
    console.log('[transcribe-file] job created, id:', id);

    // 3. Poll until completed / error (up to ~5 min).
    let transcript = null;
    for (let i = 0; i < 150; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`${AAI_BASE}/v2/transcript/${id}`, { headers: { authorization: API_KEY } });
      transcript = await pollRes.json();
      console.log('[transcribe-file] poll', i, 'status:', transcript.status, 'len:', transcript.text?.length ?? 0);
      if (transcript.status === 'completed') break;
      if (transcript.status === 'error') {
        return NextResponse.json({ error: transcript.error || 'Transcription failed' }, { status: 500 });
      }
      transcript = null;
    }
    if (!transcript) return NextResponse.json({ error: 'Transcription timed out' }, { status: 500 });

    // Format diarized utterances as "[<speaker> <m:ss>] text" blocks, matching how
    // recorded sessions are stored, so the UI renders them identically.
    const utterances = transcript.utterances || [];
    const fmtMs = ms => { const s = Math.floor((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    const text = utterances.length > 0
      ? utterances.map(u => (u.text ? `[${u.speaker} ${fmtMs(u.start)}] ${u.text.trim()}` : '')).filter(Boolean).join('\n\n')
      : (transcript.text || '').trim();

    console.log('[transcribe-file] done. language:', transcript.language_code, 'clean_len:', text.length, 'utterances:', utterances.length);
    return NextResponse.json({ text, utterances, language_code: transcript.language_code || null });
  } catch (err) {
    console.error('[transcribe-file]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
