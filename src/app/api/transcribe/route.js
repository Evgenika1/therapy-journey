import { NextResponse } from 'next/server';
import { aaiFetch, uploadAudio } from '@/lib/assemblyai';
import { MAX_UPLOAD_BYTES, fmtSize, tooLargeMessage } from '@/lib/audioUpload';
import { AAI_BASE, AAI_HEADERS, TRANSCRIBE_CONFIG } from '@/lib/transcribeJob';

// Upload only takes as long as the network needs — no more open-ended polling
// inside this function. The old `maxDuration = 3600` was above the ceiling of
// every Vercel plan (Hobby 300s, Pro/Enterprise 800s, 1800s on the extended
// beta), so a synchronous poll-to-completion could never have run there at all.
// The job is now created here and polled from /api/transcribe/status.
export const maxDuration = 300;

export async function POST(req) {
  if (!process.env.ASSEMBLYAI_API_KEY) {
    return NextResponse.json({ error: 'ASSEMBLYAI_API_KEY not configured' }, { status: 500 });
  }
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
    const upload_url = await uploadAudio(AAI_BASE, process.env.ASSEMBLYAI_API_KEY, audioBuffer, { tag: 'transcribe' });

    // 2. Create the job and return immediately — do NOT wait for it to finish.
    //    Auto-detect the spoken language (users record in different languages;
    //    forcing 'ru' on non-Russian audio made AssemblyAI hallucinate Russian).
    //    The forced-'ru' fallback now lives in /api/transcribe/status, since we
    //    only find out detection failed once the job actually completes.
    const createRes = await aaiFetch(`${AAI_BASE}/v2/transcript`, {
      method: 'POST',
      headers: AAI_HEADERS(),
      body: JSON.stringify({ audio_url: upload_url, ...TRANSCRIBE_CONFIG }),
    }, 'Create transcript', 'transcribe');
    if (!createRes.ok) {
      const err = await createRes.text();
      return NextResponse.json({ error: `Transcript create failed: ${err}` }, { status: 500 });
    }
    const { id } = await createRes.json();
    console.log('[transcribe] job created, id:', id);
    return NextResponse.json({ job_id: id });
  } catch (err) {
    console.error('[transcribe]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
