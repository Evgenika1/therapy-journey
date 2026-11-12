import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/supabaseServer';
import { usageThisPeriod, recordUsage, blockedResponseBody } from '@/lib/usageLedger';
import { cachedSystem } from '@/lib/chatPrompts';
import { SEARCH_SESSIONS_TOOL, searchSessions, formatSearchResult } from '@/lib/sessionSearch';

const MODEL = 'claude-haiku-4-5-20251001';
// How many times one answer may search before it has to reply with what it has.
const MAX_SEARCHES = 3;

export const maxDuration = 60;

export async function POST(req) {
  try {
    const { supabase, user } = await getServerUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    const quota = await usageThisPeriod(supabase, user.id);
    if (quota.status === 'blocked') {
      return NextResponse.json(blockedResponseBody(quota), { status: 402 });
    }

    const { messages, systemPrompt } = await req.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages must be a non-empty array' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
    }

    // The summaries in the system prompt do not hold the conversations
    // themselves, so the model may search the transcripts. Sessions are read
    // once, on the first search, with the user's own client: RLS keeps the
    // search to their sessions.
    let ownSessions = null;
    async function runSearch(input) {
      if (!ownSessions) {
        const { data: rows, error } = await supabase
          .from('sessions')
          .select('created_at, title, transcript, notes')
          .eq('user_id', user.id)
          .is('deleted_at', null);
        if (error) throw new Error(error.message);
        ownSessions = rows || [];
      }
      const terms = Array.isArray(input?.terms) ? input.terms : [];
      const hits = searchSessions(ownSessions, terms, { from: input?.from, to: input?.to });
      const result = formatSearchResult(hits, terms);
      // Only the excerpts reach the model, never whole transcripts; this line
      // is how that stays visible.
      console.log(`[chat] search ${JSON.stringify(terms)}: ${hits.length} excerpts, ${result.length} chars`);
      return result;
    }

    const convo = messages.map(m => ({ role: m.role, content: m.content }));
    let data;
    for (let round = 0; ; round++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          system: cachedSystem(systemPrompt),
          messages: convo,
          tools: [SEARCH_SESSIONS_TOOL],
          // Out of searches: answer from what was found.
          ...(round >= MAX_SEARCHES ? { tool_choice: { type: 'none' } } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('[chat] Claude API error:', err);
        return NextResponse.json({ error: 'Chat request failed. Please try again.' }, { status: 500 });
      }

      data = await res.json();
      // Every round is a billed call. Metering is best-effort: the answer is
      // already generated and already paid for.
      await recordUsage(supabase, { userId: user.id, kind: 'chat', model: MODEL, usage: data.usage });

      const calls = (data.content || []).filter(b => b.type === 'tool_use');
      if (data.stop_reason !== 'tool_use' || calls.length === 0) break;

      const results = [];
      for (const call of calls) {
        let content;
        try {
          content = call.name === SEARCH_SESSIONS_TOOL.name ? await runSearch(call.input) : `Unknown tool ${call.name}`;
        } catch (e) {
          console.error('[chat] search:', e?.message);
          content = 'The search failed. Answer from the summaries you have, and say the transcripts could not be searched.';
        }
        results.push({ type: 'tool_result', tool_use_id: call.id, content });
      }
      convo.push({ role: 'assistant', content: data.content });
      convo.push({ role: 'user', content: results });
    }

    const u = data.usage || {};
    console.log(`[chat] system ${(systemPrompt || '').length} chars; last call: input ${u.input_tokens}, cache read ${u.cache_read_input_tokens ?? 0}, cache write ${u.cache_creation_input_tokens ?? 0} tokens`);
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();
    return NextResponse.json({ content: text });
  } catch (err) {
    console.error('[chat]', err);
    return NextResponse.json({ error: 'Chat request failed. Please try again.' }, { status: 500 });
  }
}
