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
    if (!res.ok) {
      return NextResponse.json({ error: `Recall leave failed (${res.status}): ${rawText}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[recall/leave]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
