import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/supabaseServer';
import { deleteStoredAudio } from '@/lib/transcribeFromStorage';
import { isOwnAudioPath } from '@/lib/audioStorage';

// DELETE { path } — remove one of the caller's own recordings from Storage.
// Used when a trial job's audio turned out not to be needed (the recording fit
// inside the free minutes). Only paths under the caller's own folder.
export async function DELETE(req) {
  const { supabase, user } = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  let body; try { body = await req.json(); } catch { body = {}; }
  if (!isOwnAudioPath(body?.path, user.id)) return NextResponse.json({ error: 'Not your file.' }, { status: 403 });
  await deleteStoredAudio(supabase, body.path, user.id, 'audio-delete');
  return NextResponse.json({ ok: true });
}
