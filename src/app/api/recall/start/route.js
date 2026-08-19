import { NextResponse } from 'next/server';
import { RECALL_BASE, RECALL_HEADERS } from '@/lib/recall';

// Send a Recall bot into a meeting. Body: { meeting_url, user_id }.
// Returns { bot_id }. The AssemblyAI key is NOT here — it's set in the Recall
// EU dashboard; we only ask for AssemblyAI async transcription by name.
export async function POST(req) {
  if (!process.env.RECALL_API_KEY) {
    return NextResponse.json({ error: 'RECALL_API_KEY not configured' }, { status: 500 });
  }
  try {
    const { meeting_url, user_id } = await req.json();
    if (!meeting_url?.trim()) {
      return NextResponse.json({ error: 'meeting_url is required' }, { status: 400 });
    }

    // Recall POSTs bot events to this URL — must be publicly reachable. On
    // localhost it isn't, so we omit it and let the client poll /status instead.
    // Override with RECALL_WEBHOOK_URL when using a tunnel (ngrok) locally.
    let webhook_url = process.env.RECALL_WEBHOOK_URL;
    if (!webhook_url) {
      const host = req.headers.get('host') || '';
      if (host && !/localhost|127\.0\.0\.1/.test(host)) {
        const proto = req.headers.get('x-forwarded-proto') || 'https';
        webhook_url = `${proto}://${host}/api/recall/webhook`;
      }
    }

    const body = {
      meeting_url,
      bot_name: 'Miru Notetaker',
      recording_config: { transcript: { provider: { assembly_ai_async_chunked: {} } } },
      // Carried back on the bot object so the webhook knows which user owns it.
      metadata: user_id ? { user_id: String(user_id) } : undefined,
    };
    if (webhook_url) body.webhook_url = webhook_url;

    console.log('[Recall] meeting_url:', meeting_url);
    console.log('[Recall] request body:', JSON.stringify(body));

    const res = await fetch(`${RECALL_BASE}/bot/`, {
      method: 'POST',
      headers: RECALL_HEADERS,
      body: JSON.stringify(body),
    });

    // Read the body once as text so we can log it even when it isn't valid JSON
    // (e.g. a 400/401 error page), then try to parse it.
    const rawText = await res.text();
    let data;
    try { data = JSON.parse(rawText); } catch { data = rawText; }
    console.log('[Recall] response status:', res.status);
    console.log('[Recall] response data:', JSON.stringify(data));

    if (!res.ok) {
      return NextResponse.json({ error: `Recall bot create failed (${res.status}): ${rawText}` }, { status: 500 });
    }
    // Don't hand back an undefined bot_id — surface it as an error instead.
    if (!data?.id) {
      return NextResponse.json({ error: `Recall returned no bot id: ${rawText}` }, { status: 500 });
    }
    return NextResponse.json({ bot_id: data.id });
  } catch (err) {
    console.error('[recall/start]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
