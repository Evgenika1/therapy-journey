import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/supabaseServer';
import { usageThisMonth, recordUsage } from '@/lib/usageLedger';
import { BLOCKED_MESSAGE } from '@/lib/usageQuota';
import {
  ALLOWED_EXT, MAX_UPLOAD_BYTES, fmtSize, extOf, tooLargeMessage, unsupportedTypeMessage,
} from '@/lib/audioUpload';
import { aaiFetch, uploadAudio } from '@/lib/assemblyai';
import { AAI_BASE, AAI_HEADERS, TRANSCRIBE_CONFIG } from '@/lib/transcribeJob';

// Upload + create job only; the client then polls /api/transcribe/status, the
// same route the live recording flow uses. This used to poll to completion with
// `maxDuration = 3600` — above the ceiling of every Vercel plan, and previously
// equal to its own poll budget, so importing a long recording could not finish.
export const maxDuration = 300;

export async function POST(req) {
  // Transcription is the largest single cost in the app, so this is the gate
  // that matters most. Anonymous before now: knowing the URL was enough to
  // spend the AssemblyAI budget.
  const { supabase, user } = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  const quota = await usageThisMonth(supabase, user.id);
  if (quota.status === 'blocked') {
    return NextResponse.json({ error: BLOCKED_MESSAGE, quota: { status: quota.status, remaining: quota.remaining } }, { status: 402 });
  }

  if (!process.env.ASSEMBLYAI_API_KEY) {
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
    console.log('[transcribe-file] received:', audioBuffer.length, 'bytes');
    const upload_url = await uploadAudio(AAI_BASE, process.env.ASSEMBLYAI_API_KEY, audioBuffer, { tag: 'transcribe-file' });

    // 2. Create the job and return its id — the client polls from here on.
    const createRes = await aaiFetch(`${AAI_BASE}/v2/transcript`, {
      method: 'POST',
      headers: AAI_HEADERS(),
      body: JSON.stringify({ audio_url: upload_url, ...TRANSCRIBE_CONFIG }),
    }, 'Create transcript', 'transcribe-file');
    console.log('[transcribe-file] AAI transcript create response:', createRes.status);
    if (!createRes.ok) {
      const err = await createRes.text();
      return NextResponse.json({ error: `Transcript create failed: ${err}` }, { status: 500 });
    }
    const { id } = await createRes.json();
    console.log('[transcribe-file] job created, id:', id);
    return NextResponse.json({ job_id: id });
  } catch (err) {
    console.error('[transcribe-file]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
