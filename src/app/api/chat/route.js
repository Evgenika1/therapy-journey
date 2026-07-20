import { NextResponse } from 'next/server';

export const maxDuration = 60;

export async function POST(req) {
  try {
    const { messages, systemPrompt } = await req.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages must be a non-empty array' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt || 'You are a compassionate AI therapy companion. Be concise, warm, and insightful.',
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[chat] Claude API error:', err);
      return NextResponse.json({ error: 'Chat request failed. Please try again.' }, { status: 500 });
    }

    const data = await res.json();
    return NextResponse.json({ content: data.content?.[0]?.text || '' });
  } catch (err) {
    console.error('[chat]', err);
    return NextResponse.json({ error: 'Chat request failed. Please try again.' }, { status: 500 });
  }
}
