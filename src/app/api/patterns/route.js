import { NextResponse } from 'next/server';
import { parseAnalysis } from '@/lib/analysisParse';
import { PATTERNS_SCHEMA, MIN_ANALYSED_SESSIONS } from '@/lib/patternsInput';

// One Claude call over the user's whole history. The client assembles the
// summary (it already reads its own rows under RLS via src/lib/api.js) and
// posts it here — same division as /api/analyze, which keeps this route free of
// Supabase entirely and means no service-role key is needed to read user data.
export const maxDuration = 300;

// Same detection as /api/analyze: the field names and the JSON scaffolding are
// English, and the model will drift to English unless the language is named.
function languageDirective(text) {
  const cyr = (text.match(/[а-яё]/gi) || []).length;
  const lat = (text.match(/[a-z]/gi) || []).length;
  if (cyr > lat) {
    return 'CRITICAL: This history is in Russian. Write EVERY field value in Russian. Do NOT use English for any value.';
  }
  return 'CRITICAL: Write every field value in the SAME language as the history above. Do NOT translate it into English.';
}

export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'placeholder') {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  try {
    const { history } = await req.json();
    if (!history || !Array.isArray(history.sessions) || history.sessions.length === 0) {
      return NextResponse.json({ error: 'No history to analyse' }, { status: 400 });
    }
    if ((history.analysed_sessions ?? 0) < MIN_ANALYSED_SESSIONS) {
      return NextResponse.json(
        { error: `Need at least ${MIN_ANALYSED_SESSIONS} analysed sessions to find patterns` },
        { status: 400 });
    }

    const serialized = JSON.stringify(history, null, 1);

    const prompt = `You are a thoughtful therapist reviewing a client's ENTIRE history across many sessions at once. Your job is to see what no single session reveals: what repeats, what triggers what, and what has changed over time.

The history below is ordered OLDEST FIRST. Each session carries its date, the mood before and after where recorded, and the key points from its own analysis. Refer to sessions by their DATE, never by a number. A separate emotion log records what the client felt between sessions, with intensity 1–10; entries tagged "before"/"after" bracket a session.

Across ${history.analysed_sessions} analysed sessions out of ${history.total_sessions} total, from ${history.first_session} to ${history.last_session}, identify:

- "recurring_themes": subjects that come back again and again. For each: "theme" (short), "frequency" (state it against the real counts above, e.g. "8 of 12 sessions" — count from the data, never invent a number, and do not list session numbers), and "insight" (what the recurrence itself means, not a restatement of the theme).
- "emotional_patterns": how emotions move. Use the mood_before/mood_after pairs and the emotion log — which feelings cluster, which sessions lift the mood and which do not, what builds up between sessions. For each: "pattern" and "detail".
- "triggers": what reliably sets off a strong state. For each: "trigger" and "context" (the situations where it showed up).
- "shifts": what has genuinely CHANGED from the earliest sessions to the most recent — new capacities, softened reactions, questions that stopped repeating. For each: "shift" and "evidence" (point at the specific sessions or dates that show it). This section is about movement and progress; be honest but look hard for it.

Rules:
- Base every item strictly on the data below. Do not invent themes, emotions or events that are not there.
- Prefer few strong findings over many weak ones. An empty array is a valid answer for a section with nothing real in it.
- Write for the client to read: plain, warm, specific. No clinical labels, no diagnosis.

History:
${serialized}

${languageDirective(serialized)}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: { type: 'json_schema', schema: PATTERNS_SCHEMA } },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[patterns] Claude API error:', err);
      return NextResponse.json({ error: 'Pattern analysis failed. Please try again.' }, { status: 500 });
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text || '';
    // Shape, not content: this is therapy material and must not reach the log.
    console.log('[patterns] stop_reason:', data.stop_reason,
      '| output_tokens:', data.usage?.output_tokens, '| chars:', raw.length);

    const analysis = parseAnalysis(raw);
    if (!analysis) {
      const reason = data.stop_reason === 'max_tokens'
        ? 'ответ модели оборвался на середине. Попробуйте ещё раз.'
        : data.stop_reason === 'refusal'
          ? 'модель отказалась анализировать эту историю.'
          : !raw.trim()
            ? 'модель вернула пустой ответ.'
            : `модель вернула не-JSON. Начало ответа: ${raw.trim().slice(0, 200)}`;
      console.error('[patterns] unparseable. stop_reason:', data.stop_reason);
      return NextResponse.json(
        { error: `Не удалось разобрать паттерны — ${reason}`, stop_reason: data.stop_reason ?? null },
        { status: 502 });
    }

    return NextResponse.json({ analysis });
  } catch (err) {
    console.error('[patterns]', err);
    return NextResponse.json({ error: 'Pattern analysis failed. Please try again.' }, { status: 500 });
  }
}
