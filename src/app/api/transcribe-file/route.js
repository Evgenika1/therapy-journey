import { NextResponse } from 'next/server';
import {
  ALLOWED_EXT, MAX_UPLOAD_BYTES, fmtSize, extOf, tooLargeMessage, unsupportedTypeMessage,
} from '@/lib/audioUpload';

export const maxDuration = 300; // 5 minutes — long uploads + async transcription

// GDPR: use the AssemblyAI EU region for BOTH upload and transcript so audio and
// text stay in the EU. The API key is the same one used elsewhere in the app.
const AAI_BASE = 'https://api.eu.assemblyai.com';
const API_KEY = process.env.ASSEMBLYAI_API_KEY;

// Node's fetch collapses every transport failure into a bare "fetch failed" and
// hides the actual reason in err.cause. Unwrap it — that opacity is exactly what
// made a 3 GB upload look like an AssemblyAI outage.
async function aaiFetch(url, init, step) {
  try {
    return await fetch(url, init);
  } catch (err) {
    const cause = err?.cause;
    console.error(`[transcribe-file] ${step} — fetch threw:`, err.message, '| cause:', cause);
    throw new Error(`${step}: ${cause?.code || cause?.message || err.message}`);
  }
}

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
    const ext = extOf(filename);
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json({ error: unsupportedTypeMessage(ext) }, { status: 400 });
    }

    // Reject oversize uploads from the header, BEFORE buffering — otherwise we
    // spend minutes pulling gigabytes into memory only to die on the fetch.
    const declared = Number(req.headers.get('content-length')) || 0;
    console.log('[transcribe-file] name:', filename, 'content-length:', declared, `(${fmtSize(declared)})`);
    if (declared > MAX_UPLOAD_BYTES) {
      console.warn('[transcribe-file] rejected up front: over', MAX_UPLOAD_BYTES, 'bytes');
      return NextResponse.json({ error: tooLargeMessage(declared, ext) }, { status: 413 });
    }

    // 1. Upload the audio to AssemblyAI (EU).
    const audioBuffer = Buffer.from(await req.arrayBuffer());
    if (audioBuffer.length === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 });
    // Re-check the real size: Content-Length is absent on chunked requests.
    if (audioBuffer.length > MAX_UPLOAD_BYTES) {
      console.warn('[transcribe-file] rejected after buffering:', audioBuffer.length, 'bytes');
      return NextResponse.json({ error: tooLargeMessage(audioBuffer.length, ext) }, { status: 413 });
    }
    console.log('[transcribe-file] received:', audioBuffer.length, 'bytes — uploading to AssemblyAI...');
    const uploadRes = await aaiFetch(`${AAI_BASE}/v2/upload`, {
      method: 'POST',
      headers: { authorization: API_KEY, 'content-type': 'application/octet-stream' },
      body: audioBuffer,
    }, 'Загрузка в AssemblyAI');
    console.log('[transcribe-file] AAI upload response:', uploadRes.status);
    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return NextResponse.json({ error: `Upload failed: ${err}` }, { status: 500 });
    }
    const { upload_url } = await uploadRes.json();

    // 2. Create the transcription job (auto language detection + speaker labels).
    const createRes = await aaiFetch(`${AAI_BASE}/v2/transcript`, {
      method: 'POST',
      headers: { authorization: API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        audio_url: upload_url,
        language_detection: true,
        speaker_labels: true,
      }),
    }, 'Создание транскрипта');
    console.log('[transcribe-file] AAI transcript create response:', createRes.status);
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
      const pollRes = await aaiFetch(`${AAI_BASE}/v2/transcript/${id}`, { headers: { authorization: API_KEY } }, 'Опрос статуса транскрипта');
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
