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

    const prompt = `You are a compassionate, thorough therapy session analyst. Analyse the ENTIRE therapy session transcript below — it may be long and cover many distinct topics discussed at different points. Do NOT focus only on the opening topic; read through to the end and give every major topic equal attention.

Return a JSON object with EXACTLY these fields. Use arrays where indicated; return an empty array [] (or null for string fields) when a section genuinely has nothing.

- "topics_covered": array of strings — EVERY distinct topic discussed, one short line each, in the order they arose
- "overview": array of strings — a 2-3 sentence summary for EACH major topic (one array item per topic)
- "key_theme": string or null — the single connecting psychological pattern across topics, if one exists (1-2 sentences)
- "breakthroughs": array of strings — each insight, realisation, or emotional shift reached (one per item; empty array if none)
- "emotions_identified": array of strings — named emotions with brief context, e.g. "envy — toward a friend's new relationship"
- "action_items": array of strings — concrete next steps or practices, ideally one per relevant topic
- "patterns_triggers": array of strings — recurring behavioural or emotional patterns and their triggers
- "continuity_notes": array of strings — anything connecting to previous sessions or earlier topics
- "for_next_session": array of strings — explicitly deferred threads or unresolved questions
- "emotional_intensity_markers": array of strings — the moment(s) of highest emotional charge, each with a brief quote or paraphrase of what was happening

IMPORTANT: Always respond in the SAME language as the transcript. If the transcript is in Russian — respond in Russian. If in English — respond in English. If mixed — use the dominant language. This applies to ALL fields and all array items.

Base every item strictly on what is actually in the transcript. Do not invent topics, emotions, or breakthroughs that are not supported by the text.

Respond ONLY with valid JSON. No markdown, no explanation, no code fences.

Transcript:
${transcript}

${notes ? `Session notes:\n${notes}` : ''}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        // 10-section analysis over a full-length transcript needs real output
        // headroom; 512 truncated multi-topic summaries mid-JSON.
        max_tokens: 4096,
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
