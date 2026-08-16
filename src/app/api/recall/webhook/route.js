import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { getBot, botStatus, fetchTranscriptText } from '@/lib/recall';

// Recall delivers webhooks via Svix. Verify the signature over the RAW body:
// signed content is `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256 with
// the base64 secret (the part after "whsec_"), compared base64 to any v1 sig.
function verifySvix(rawBody, headers, secret) {
  const id = headers.get('svix-id');
  const ts = headers.get('svix-timestamp');
  const sigHeader = headers.get('svix-signature');
  if (!id || !ts || !sigHeader) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest('base64');
  return sigHeader.split(' ').some(part => {
    const sig = part.includes(',') ? part.split(',')[1] : part; // "v1,<sig>"
    try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
  });
}

export async function POST(req) {
  const raw = await req.text(); // raw body required for signature verification

  const secret = process.env.RECALL_WEBHOOK_SECRET;
  if (secret) {
    if (!verifySvix(raw, req.headers, secret)) {
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
    }
  } else {
    console.warn('[recall/webhook] RECALL_WEBHOOK_SECRET not set — skipping signature verification');
  }

  let event;
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  const type = event?.event || event?.type;
  const botId = event?.data?.bot_id || event?.data?.bot?.id || event?.data?.id;
  console.log('[recall/webhook] event:', type, 'bot:', botId);

  // We only act on the bot reaching "done" with a transcript. Re-fetch the bot
  // for authoritative status + recordings rather than trusting the event body.
  try {
    if (botId) {
      const bot = await getBot(botId);
      if (botStatus(bot) === 'done') {
        const transcript = await fetchTranscriptText(bot);
        const userId = bot?.metadata?.user_id;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (transcript && userId && serviceKey) {
          // Service role bypasses RLS (there's no user session in a webhook).
          const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
            auth: { persistSession: false },
          });
          // Dedupe on recall_bot_id so the webhook and the client-poll path can't
          // both create a session for the same meeting.
          const { error } = await admin
            .from('sessions')
            .upsert({ user_id: userId, title: null, transcript, notes: null, recall_bot_id: botId },
                    { onConflict: 'recall_bot_id', ignoreDuplicates: true });
          if (error) console.error('[recall/webhook] insert error:', error.message);
        } else {
          console.warn('[recall/webhook] not creating session — missing:', {
            hasTranscript: !!transcript, userId, hasServiceKey: !!serviceKey,
          });
        }
      }
    }
  } catch (err) {
    console.error('[recall/webhook]', err);
    // Still 200 so Recall/Svix doesn't hammer retries on a transient error.
  }

  return NextResponse.json({ received: true });
}
