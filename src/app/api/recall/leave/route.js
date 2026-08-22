import { NextResponse } from 'next/server';
import { RECALL_BASE, RECALL_HEADERS } from '@/lib/recall';

// Tell a bot to leave the call. Body: { bot_id }.
// After it leaves, Recall finalises the recording and (async) the transcript;
// the client keeps polling /status until it reaches "done".
export async function POST(req) {
  if (!process.env.RECALL_API_KEY) {
    return NextResponse.json({ error: 'RECALL_API_KEY not configured' }, { status: 500 });
  }
  try {
    const { bot_id } = await req.json();
    if (!bot_id) return NextResponse.json({ error: 'bot_id is required' }, { status: 400 });

    const res = await fetch(`${RECALL_BASE}/bot/${bot_id}/leave_call/`, {
      method: 'POST',
      headers: RECALL_HEADERS,
    });
    const rawText = await res.text();
    console.log('[recall/leave] bot:', bot_id, 'status:', res.status, 'body:', rawText);

    // A bot that already finished (async mode often lets it complete on its own
    // before we send leave_call) rejects the command with 400
    // "cannot_command_completed_bot". That's not a real error — the goal (bot is
    // no longer in the meeting) is already met, so treat it like success.
    if (res.status === 400 && rawText.includes('cannot_command_completed_bot')) {
      return NextResponse.json({ ok: true, already_done: true });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `Recall leave failed (${res.status}): ${rawText}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[recall/leave]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
