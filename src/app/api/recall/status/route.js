import { NextResponse } from 'next/server';
import { getBot, botStatus, fetchTranscriptText } from '@/lib/recall';

// Poll a bot's status. GET /api/recall/status?bot_id=...
// → { status: 'joining'|'recording'|'processing'|'done'|'error', transcript }
// transcript is filled only once status === 'done'. This is the local-dev path
// (works without a public webhook) and a fallback in production.
export async function GET(req) {
  if (!process.env.RECALL_API_KEY) {
    return NextResponse.json({ error: 'RECALL_API_KEY not configured' }, { status: 500 });
  }
  const bot_id = new URL(req.url).searchParams.get('bot_id');
  if (!bot_id) return NextResponse.json({ error: 'bot_id is required' }, { status: 400 });

  try {
    const bot = await getBot(bot_id);
    const status = botStatus(bot);
    const transcript = status === 'done' ? await fetchTranscriptText(bot) : null;
    return NextResponse.json({ status, transcript });
  } catch (err) {
    console.error('[recall/status]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
