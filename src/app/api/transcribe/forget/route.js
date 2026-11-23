import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/supabaseServer';
import { aaiFetch } from '@/lib/assemblyai';
import { AAI_BASE, AAI_HEADERS } from '@/lib/transcribeJob';

// POST { job_id } — delete AssemblyAI's copy of a finished transcript (DPIA
// action 1: a processor must not keep session content longer than needed).
//
// Called by the browser only AFTER it has the text safe (on the device or in
// the session row). Deleting on the server the moment the job completes would
// lose the transcript whenever that response failed to arrive: a re-poll after
// a reload would find nothing.
//
// Only a job billed to the caller can be deleted: the ledger row written when
// it completed (kind transcribe, external_id = job id) is read with the
// caller's own session, so row-level security decides.
export async function POST(req) {
  const { supabase, user } = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  let body; try { body = await req.json(); } catch { body = {}; }
  const jobId = typeof body?.job_id === 'string' ? body.job_id : '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(jobId)) return NextResponse.json({ error: 'job_id is required' }, { status: 400 });

  const { data: own, error } = await supabase.from('usage_events')
    .select('id').eq('user_id', user.id).eq('kind', 'transcribe').eq('external_id', jobId).limit(1);
  if (error) return NextResponse.json({ error: 'Could not check the job.' }, { status: 500 });
  if (!own?.length) return NextResponse.json({ error: 'Not your job.' }, { status: 403 });

  try {
    const res = await aaiFetch(`${AAI_BASE}/v2/transcript/${jobId}`, { method: 'DELETE', headers: AAI_HEADERS() }, 'Delete transcript', 'transcribe-forget');
    if (!res.ok) {
      console.error('[transcribe-forget]', jobId, res.status, (await res.text()).slice(0, 200));
      return NextResponse.json({ deleted: false }, { status: 502 });
    }
    console.log('[transcribe-forget] deleted at AssemblyAI:', jobId);
    return NextResponse.json({ deleted: true });
  } catch (e) {
    console.error('[transcribe-forget]', jobId, e?.message);
    return NextResponse.json({ deleted: false }, { status: 502 });
  }
}
