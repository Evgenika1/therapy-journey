import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/supabaseServer';
import { recordUsage } from '@/lib/usageLedger';
import { aaiFetch } from '@/lib/assemblyai';
import {
  AAI_BASE, AAI_HEADERS, FORCED_RU_CONFIG,
  shouldRetryForcedRu, isNoSpeech, completedPayload,
} from '@/lib/transcribeJob';

// One poll of a transcription job. GET /api/transcribe/status?job_id=…
//
// The client drives the polling loop, so this returns in well under a second and
// the whole flow stays inside Vercel's function duration limit no matter how
// long the recording is — which the old poll-to-completion route could not do.
//
//   { status: 'processing' }
//   { status: 'processing', job_id, retried: true }   ← forced-ru retry started
//   { status: 'completed', text, utterances, language_code }
//   { status: 'completed', text: '', utterances: [], noSpeech: true }
//   { status: 'error', error }
export const maxDuration = 60;

export async function GET(req) {
  // Polled, not gated: a job already running is already paid for, and stopping
  // a poll would only lose the transcript the account has been billed for. The
  // gate lives on the two routes that START a job.
  const { supabase, user } = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  if (!process.env.ASSEMBLYAI_API_KEY) {
    return NextResponse.json({ error: 'ASSEMBLYAI_API_KEY not configured' }, { status: 500 });
  }
  const url = new URL(req.url);
  const jobId = url.searchParams.get('job_id');
  // Set by the client once a forced-ru retry has already been started, so a job
  // that keeps failing cannot bounce between attempts forever.
  const alreadyRetried = url.searchParams.get('retried') === '1';
  if (!jobId) return NextResponse.json({ error: 'job_id is required' }, { status: 400 });

  try {
    const res = await aaiFetch(`${AAI_BASE}/v2/transcript/${jobId}`,
      { headers: AAI_HEADERS() }, 'Poll transcript status', 'transcribe-status');
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Status check failed (${res.status}): ${err}` }, { status: 502 });
    }
    const transcript = await res.json();
    console.log('[transcribe-status]', jobId, 'status:', transcript.status,
      'len:', transcript.text?.length ?? 0);

    if (transcript.status === 'completed') {
      // Bill here, and only here. The duration comes from AssemblyAI's own
      // audio_duration rather than the browser's timer — the client's number is
      // what its tab believes happened, and anyone wanting free transcription
      // can edit it. externalId makes the write idempotent, so the re-poll after
      // a reload cannot bill the same audio twice.
      await recordUsage(supabase, {
        userId: user.id, kind: 'transcribe', externalId: jobId,
        audioSeconds: Math.round(transcript.audio_duration ?? 0),
      });
      return NextResponse.json(completedPayload(transcript));
    }

    if (transcript.status === 'error') {
      if (isNoSpeech(transcript)) {
        console.log('[transcribe-status] rejected (insufficient speech):', transcript.error);
        return NextResponse.json({ status: 'completed', text: '', utterances: [], language_code: null, noSpeech: true });
      }
      // Retry the same uploaded audio with the language forced, then hand the
      // client the new job id to keep polling. audio_url comes back on the
      // errored transcript, so the upload is not repeated.
      if (!alreadyRetried && shouldRetryForcedRu(transcript) && transcript.audio_url) {
        console.log('[transcribe-status] auto-detect/transcoding failed, retrying with forced ru:', transcript.error);
        const retryRes = await aaiFetch(`${AAI_BASE}/v2/transcript`, {
          method: 'POST',
          headers: AAI_HEADERS(),
          body: JSON.stringify({ audio_url: transcript.audio_url, ...FORCED_RU_CONFIG }),
        }, 'Recreate transcript', 'transcribe-status');
        if (retryRes.ok) {
          const { id } = await retryRes.json();
          console.log('[transcribe-status] retry job created, id:', id);
          return NextResponse.json({ status: 'processing', job_id: id, retried: true });
        }
        console.error('[transcribe-status] retry create failed:', await retryRes.text());
      }
      return NextResponse.json({ status: 'error', error: transcript.error || 'Transcription failed' });
    }

    // queued / processing
    return NextResponse.json({ status: 'processing' });
  } catch (err) {
    console.error('[transcribe-status]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
