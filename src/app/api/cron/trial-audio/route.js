import { NextResponse } from 'next/server';
import { serviceSupabase } from '@/lib/stripeServer';
import { AUDIO_BUCKET } from '@/lib/audioStorage';

// Daily (vercel.json). A cut trial session keeps its audio for 30 days so the
// whole session can be transcribed after a plan is chosen (028). After that
// the audio is removed and the session forgets it — session audio is health
// data and must not outlive its purpose. Only those kept files: nothing else
// in the bucket is touched here.
//
// Vercel signs cron calls with CRON_SECRET; nothing else may run this.
export const maxDuration = 60;
const KEEP_DAYS = 30;

export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 401 });
  }
  const admin = serviceSupabase();
  const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 3600 * 1000).toISOString();

  const { data: old, error } = await admin.from('sessions')
    .select('id, full_audio_path')
    .not('full_audio_path', 'is', null)
    .lt('full_audio_kept_at', cutoff)
    .limit(500);
  if (error) {
    console.error('[cron trial-audio] read:', error.message);
    return NextResponse.json({ error: 'Could not read sessions.' }, { status: 500 });
  }

  let cleared = 0;
  for (const s of old ?? []) {
    const { error: rmErr } = await admin.storage.from(AUDIO_BUCKET).remove([s.full_audio_path]);
    if (rmErr) { console.error('[cron trial-audio] remove:', rmErr.message); continue; }
    await admin.from('sessions').update({ full_audio_path: null, full_audio_kept_at: null }).eq('id', s.id);
    cleared++;
  }
  console.log('[cron trial-audio] kept audio removed after 30 days:', cleared);
  return NextResponse.json({ cleared });
}
