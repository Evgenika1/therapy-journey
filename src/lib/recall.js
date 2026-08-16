// Recall.ai helpers. EU region only — the API key is region-scoped and every
// endpoint lives under the region host (NOT us-west-2).
//
// Auth is the RAW API key in the Authorization header — no "Bearer", no "Token".
// The AssemblyAI key is NOT sent from here: it's configured once in the Recall
// EU dashboard (Transcription providers), and Recall uses it server-side.

const REGION = process.env.RECALL_REGION || 'eu-central-1';
export const RECALL_BASE = `https://${REGION}.recall.ai/api/v1`;
export const RECALL_HEADERS = {
  Authorization: process.env.RECALL_API_KEY || '',
  'Content-Type': 'application/json',
};

export async function getBot(botId) {
  const res = await fetch(`${RECALL_BASE}/bot/${botId}/`, { headers: RECALL_HEADERS });
  if (!res.ok) throw new Error(`Recall get bot failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Collapse Recall's status_changes into a simple UI status the client can render:
// joining → recording → processing → done (or error).
export function botStatus(bot) {
  const changes = bot?.status_changes || [];
  const code = changes.length ? changes[changes.length - 1].code : (bot?.status?.code || 'unknown');
  if (['joining_call', 'in_waiting_room'].includes(code)) return 'joining';
  if (['in_call_recording', 'recording'].includes(code)) return 'recording';
  if (['done'].includes(code)) return 'done';
  if (['fatal', 'error', 'call_failed'].includes(code)) return 'error';
  // call_ended / analysis_done / in_call_not_recording etc. → still finishing up
  return 'processing';
}

// Fetch the finished transcript and flatten it to plain text. When the bot is
// done, the recording exposes it via recordings[].media_shortcuts.transcript,
// whose `.data.download_url` points at a JSON of speaker-labelled segments.
// NOTE: verify this JSON shape against a real Recall response — segment/word
// field names have varied across API versions.
export async function fetchTranscriptText(bot) {
  const rec = (bot?.recordings || [])[0];
  const url = rec?.media_shortcuts?.transcript?.data?.download_url;
  if (!url) return '';
  const res = await fetch(url);
  if (!res.ok) return '';
  return transcriptJsonToText(await res.json());
}

function transcriptJsonToText(json) {
  const segments = Array.isArray(json) ? json : (json?.transcript || json?.segments || []);
  if (!Array.isArray(segments)) return typeof json === 'string' ? json : '';
  const lines = [];
  for (const seg of segments) {
    const words = seg.words || seg.text_segments || [];
    const text = Array.isArray(words)
      ? words.map(w => (w.text ?? w.word ?? '')).join(' ').replace(/\s+/g, ' ').trim()
      : (seg.text || '').trim();
    if (!text) continue;
    const speaker = seg.speaker ?? seg.participant?.name ?? seg.participant?.id;
    lines.push(speaker != null ? `Speaker ${speaker}: ${text}` : text);
  }
  return lines.join('\n\n').trim();
}
