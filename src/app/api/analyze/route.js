import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/supabaseServer';
import { usageThisMonth, recordUsage } from '@/lib/usageLedger';
import { BLOCKED_MESSAGE } from '@/lib/usageQuota';
import { parseAnalysis } from '@/lib/analysisParse';
import { ANALYSIS_SCHEMA } from '@/lib/analysisFormat';

// A 10-section analysis of a 90-minute session can run well past a minute now
// that max_tokens gives it room to finish instead of being cut off.
export const maxDuration = 300;

// Detect the transcript's dominant script and return an explicit, forceful
// language directive. Haiku inconsistently honours the "respond in the same
// language" instruction against the English-dominant prompt (field names,
// "Speaker A:" prefixes), so we name the language when it's clearly Russian and
// otherwise hard-forbid translating to English.
function languageDirective(text) {
  const cyr = (text.match(/[а-яё]/gi) || []).length;
  const lat = (text.match(/[a-z]/gi) || []).length;
  if (cyr > lat) {
    return 'CRITICAL: The transcript is in Russian. Write the ENTIRE JSON — every field value and every array item — in Russian. Do NOT use English for any value.';
  }
  return 'CRITICAL: Write the ENTIRE JSON — every field value and every array item — in the SAME language as the transcript above. Do NOT translate it into English.';
}

// The analysis shape is enforced server-side by the API rather than merely
// asked for in the prompt: with output_config.format the model cannot emit
// prose, a markdown fence, or a truncated object. The schema lives in
// @/lib/analysisFormat alongside the field list the UI renders, so the two can
// no longer drift apart.

export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'placeholder') {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  try {
        const { supabase, user } = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    // The limit is soft: an account only stops here once it is past the
    // overdraft, and work already in flight is never interrupted.
    const quota = await usageThisMonth(supabase, user.id);
    if (quota.status === 'blocked') {
      return NextResponse.json({ error: BLOCKED_MESSAGE, quota: { status: quota.status, remaining: quota.remaining } }, { status: 402 });
    }

    const { transcript, notes, session_id: sessionId = null } = await req.json();
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
- "homework": array of 2-4 objects, each {"task": string, "context": string} — practices to try before the next session, drawn from what was ACTUALLY discussed
  * "task": one small, concrete thing to try, doable within a week
  * "context": one sentence naming what in the session it came from — "you spoke about being afraid to open up, so..."
  * TONE (required): an invitation, never an instruction. Write "you might try...", "it could be worth noticing..." — never "you must", "do this every day".
  * Never prescribe clinical interventions, medication, or anything that is a therapist's judgement to make. These supplement the work with a therapist; they never replace it.
  * Ground every item in the transcript. If the session does not support two concrete practices, return fewer — an empty array is better than a generic suggestion like "practise self-care".
- "patterns_triggers": array of strings — recurring behavioural or emotional patterns and their triggers
- "continuity_notes": array of strings — anything connecting to previous sessions or earlier topics
- "for_next_session": array of strings — explicitly deferred threads or unresolved questions
- "emotional_intensity_markers": array of strings — the moment(s) of highest emotional charge, each with a brief quote or paraphrase of what was happening

IMPORTANT: Always respond in the SAME language as the transcript. If the transcript is in Russian — respond in Russian. If in English — respond in English. If mixed — use the dominant language. This applies to ALL fields and all array items.

Base every item strictly on what is actually in the transcript. Do not invent topics, emotions, or breakthroughs that are not supported by the text.

Respond ONLY with valid JSON. No markdown, no explanation, no code fences.

Transcript:
${transcript}

${notes ? `Session notes:\n${notes}` : ''}

${languageDirective(transcript)}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        // A 10-section analysis of a 90-minute session is genuinely long. At 4096
        // a dense transcript could be cut off mid-object, and a truncated object
        // has no closing brace — which is exactly how this surfaced as an
        // unhelpful "Could not parse Claude response".
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[analyze] Claude API error:', err);
      return NextResponse.json({ error: 'Analysis failed. Please try again.' }, { status: 500 });
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text || '';
    // Log the shape, not the content: this is therapy material, and the whole
    // analysis was previously written to the server log on every success.
    console.log('[analyze] stop_reason:', data.stop_reason,
      '| output_tokens:', data.usage?.output_tokens, '| chars:', raw.length);

    await recordUsage(supabase, { userId: user.id, kind: 'analyze', sessionId: sessionId,
      model: 'claude-haiku-4-5-20251001', usage: data.usage });

    const analysis = parseAnalysis(raw);
    if (!analysis) {
      // Say WHICH way it went wrong — "could not parse" alone told the user
      // nothing they could act on.
      const reason = data.stop_reason === 'max_tokens'
        ? 'the model ran past its token limit and stopped mid-answer. Try splitting the transcript into parts.'
        : data.stop_reason === 'refusal'
          ? 'the model declined to analyse this text.'
          : !raw.trim()
            ? 'the model returned an empty response.'
            : `the model returned something other than JSON. It began: ${raw.trim().slice(0, 200)}`;
      console.error('[Analyze] unparseable. stop_reason:', data.stop_reason, '| raw:', raw.slice(0, 500));
      return NextResponse.json(
        { error: `Could not parse the analysis — ${reason}`, stop_reason: data.stop_reason ?? null },
        { status: 502 });
    }

    return NextResponse.json({ analysis });
  } catch (err) {
    console.error('[analyze]', err);
    return NextResponse.json({ error: 'Analysis failed. Please try again.' }, { status: 500 });
  }
}
