// The prompt for analysing a coaching session. The therapy prompt stays in the
// route untouched; this one differs in what it looks for — where the person is
// heading and what they agreed to do — and in being handed the goals from the
// previous coaching session, which is what lets progress be tracked at all.
//
// A pure function so the parts that matter (previous goals, the rules) can be
// tested without calling the model.

export function coachingPrompt({ transcript, notes = '', previousGoals = [], languageDirective = '' }) {
  const prior = Array.isArray(previousGoals) && previousGoals.length
    ? `Goals as they stood after the previous coaching session (JSON):\n${JSON.stringify(previousGoals, null, 1)}\n\nFor each of these, decide from THIS transcript whether it is "in_progress", "changed" (reworded or re-scoped), "achieved" or "dropped" (set aside). If a goal is not mentioned at all, keep it "in_progress" with progress "not discussed this session". Add any goal raised for the first time as "new".`
    : 'This is the first analysed coaching session: there are no previous goals, so every goal you find has status "new".';

  return `You are a thorough, supportive coaching session analyst. Analyse the ENTIRE coaching session transcript below — read through to the end and give every major topic equal attention.

${prior}

Return a JSON object with EXACTLY these fields. Return an empty array [] when a section genuinely has nothing.

- "topics_covered": array of strings — every distinct topic discussed, one short line each, in the order they arose
- "overview": array of strings — a 2-3 sentence summary for EACH major topic
- "goals": array of objects {"goal": string, "status": "new" | "in_progress" | "changed" | "achieved" | "dropped", "progress": string} — what the person is working towards, with one sentence on what this session showed about it
- "homework": array of objects {"task": string, "due": string or null, "context": string} — the next steps
  * Only steps that were actually agreed in the session. Never invent a step the person did not commit to.
  * "due": the deadline exactly as it was said ("by Friday", "before the next session"), or null if none was said. Do not convert it to a date.
  * "context": one sentence naming what in the session the step came from.
  * Tone: direct and concrete, never pushy. These are the person's own commitments.
- "obstacles": array of objects {"obstacle": string, "context": string} — what is getting in the way: beliefs, fears, lack of time or resources — grounded in what was said
- "insights": array of strings — realisations the person reached, and powerful questions the coach asked that are worth coming back to
- "for_next_session": array of strings — threads explicitly left for next time, or questions still open

Rules:
- Base every item strictly on the transcript. An empty array is better than a generic item like "stay motivated".
- If something heavy comes up — health, a crisis, grief — note it gently in "overview" and never diagnose. Coaching is not therapy; do not give clinical advice.
- IMPORTANT: Always respond in the SAME language as the transcript, in ALL fields and all array items.

Respond ONLY with valid JSON. No markdown, no explanation, no code fences.

Transcript:
${transcript}

${typeof notes === 'string' && notes.trim() ? `Session notes:\n${notes.trim()}` : ''}

${languageDirective}`;
}
