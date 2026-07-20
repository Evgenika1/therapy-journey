import { NextResponse } from 'next/server';

export const maxDuration = 60;

export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'placeholder') {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  try {
    const { transcript, notes } = await req.json();
    if (!transcript?.trim()) {
      return NextResponse.json({ error: 'No transcript to analyse' }, { status: 400 });
    }

    const prompt = `You are a compassionate therapy session analyst. Analyse the following therapy session transcript and return a JSON object with exactly these four fields:

- "overview": 2-3 sentence summary of the session (what was discussed)
- "key_theme": the main psychological theme or pattern that emerged (1-2 sentences)
- "breakthrough": any insight, realisation or emotional shift the client experienced (1-2 sentences, or null if none)
- "action": a concrete next step or practice the client could try (1-2 sentences)

IMPORTANT: Always respond in the SAME language as the transcript. If the transcript is in Russian — respond in Russian. If in English — respond in English. If mixed — use the dominant language of the transcript. This rule applies to ALL fields: overview, key_theme, breakthrough, action.

Respond ONLY with valid JSON. No markdown, no explanation.

Transcript:
${transcript.slice(0, 6000)}${notes ? `\n\nSession notes:\n${notes}` : ''}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[analyze] Claude API error:', err);
      return NextResponse.json({ error: 'Analysis failed. Please try again.' }, { status: 500 });
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text || '';

    let analysis;
    try {
      analysis = JSON.parse(raw);
    } catch {
      // Try to extract JSON from the response if wrapped in text
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) analysis = JSON.parse(match[0]);
      else return NextResponse.json({ error: 'Could not parse Claude response', raw }, { status: 500 });
    }

    return NextResponse.json({ analysis });
  } catch (err) {
    console.error('[analyze]', err);
    return NextResponse.json({ error: 'Analysis failed. Please try again.' }, { status: 500 });
  }
}
