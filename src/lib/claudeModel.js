// The Claude model Kevi's analysis, patterns and chat run on, and the bits of
// response handling every route needs with it.
//
// Claude Sonnet 5.5 thinks before it answers (adaptive thinking is on by
// default and cannot be switched off), so a response can start with a
// `thinking` block: the answer is the first `text` block, never content[0].
// How much it thinks is set per route with output_config.effort.

export const CLAUDE_MODEL = 'claude-sonnet-5-5';

// Effort per route: an analysis is read once and kept, so it gets more
// thought; chat is a conversation and has to answer quickly.
export const EFFORT = { analyze: 'medium', patterns: 'medium', chat: 'low' };

export function responseText(data) {
  return (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();
}

// A decline arrives as HTTP 200 with stop_reason "refusal" and no usable text.
// Therapy material can touch self-harm or abuse; when the model declines, the
// person should get a clear message, not a parse error.
export function isRefusal(data) {
  return data?.stop_reason === 'refusal';
}

export const REFUSAL_MESSAGE =
  'The AI could not process this text. If something in it is about your safety, please reach out to someone you trust or a local crisis line. You can still read and edit the transcript.';
