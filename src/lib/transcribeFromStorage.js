import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/supabaseServer';
import { usageThisMonth } from '@/lib/usageLedger';
import { BLOCKED_MESSAGE } from '@/lib/usageQuota';
import { aaiFetch } from '@/lib/assemblyai';
import { AAI_BASE, AAI_HEADERS, TRANSCRIBE_CONFIG } from '@/lib/transcribeJob';
import { AUDIO_BUCKET, AUDIO_URL_TTL_SECONDS, isOwnAudioPath } from '@/lib/audioStorage';
import { extOf, unsupportedTypeMessage } from '@/lib/audioUpload';

// Start a transcription job for audio the browser has already put in Storage.
// Shared by /api/transcribe (a live recording) and /api/transcribe-file (an
// imported file): the two differ only in which extensions they accept.
//
// The request body is `{ path, filename? }` — a few bytes. The audio itself
// never passes through a Vercel function, whose 4.5 MB body limit is what used
// to reject every recording longer than a few minutes.
export async function startJobFromStorage(req, { tag, allowedExt = null }) {
  // Transcription is the largest single cost in the app, so this is the gate
  // that matters most.
  const { supabase, user } = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  const quota = await usageThisMonth(supabase, user.id);
  if (quota.status === 'blocked') {
    return NextResponse.json({ error: BLOCKED_MESSAGE, quota: { status: quota.status, remaining: quota.remaining } }, { status: 402 });
  }
  if (!process.env.ASSEMBLYAI_API_KEY) {
    return NextResponse.json({ error: 'ASSEMBLYAI_API_KEY not configured' }, { status: 500 });
  }

  let body;
  try { body = await req.json(); } catch { body = null; }
  const path = body?.path;
  // The only thing standing between an account and another account's audio:
  // a signed link is created with this user's own session, so RLS would refuse a
  // foreign path anyway, but a path outside their folder is rejected outright.
  if (!isOwnAudioPath(path, user.id)) {
    return NextResponse.json({ error: 'Invalid audio location.' }, { status: 400 });
  }
  if (allowedExt) {
    const ext = extOf(typeof body?.filename === 'string' ? body.filename : path);
    if (!allowedExt.includes(ext)) {
      return NextResponse.json({ error: unsupportedTypeMessage(ext) }, { status: 400 });
    }
  }

  try {
    const { data: signed, error: signError } = await supabase.storage
      .from(AUDIO_BUCKET).createSignedUrl(path, AUDIO_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      console.error(`[${tag}] signed url:`, signError?.message);
      return NextResponse.json({ error: 'The uploaded recording could not be found. Try again.' }, { status: 404 });
    }

    // Create the job and return immediately; the client polls
    // /api/transcribe/status, which also deletes the file once the job settles.
    const createRes = await aaiFetch(`${AAI_BASE}/v2/transcript`, {
      method: 'POST',
      headers: AAI_HEADERS(),
      body: JSON.stringify({ audio_url: signed.signedUrl, ...TRANSCRIBE_CONFIG }),
    }, 'Create transcript', tag);
    if (!createRes.ok) {
      const err = await createRes.text();
      return NextResponse.json({ error: `Transcript create failed: ${err}` }, { status: 500 });
    }
    const { id } = await createRes.json();
    // The path, not the link: the signed URL is a bearer credential for the audio.
    console.log(`[${tag}] job created, id:`, id, 'path:', path);
    return NextResponse.json({ job_id: id });
  } catch (err) {
    console.error(`[${tag}]`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Remove a settled job's audio. Best effort: a failed delete is logged, never
// allowed to turn a finished transcript into an error.
export async function deleteStoredAudio(supabase, path, userId, tag) {
  if (!isOwnAudioPath(path, userId)) return;
  const { error } = await supabase.storage.from(AUDIO_BUCKET).remove([path]);
  if (error) console.error(`[${tag}] delete audio:`, error.message);
  else console.log(`[${tag}] deleted audio:`, path);
}
