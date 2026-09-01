// Pure transcript helpers, shared by the Sessions page and /api/transcribe.
//
// These used to live inline in src/app/sessions/page.js, with the hallucination
// filter duplicated verbatim in the transcribe route — two copies of a regex
// list that had to stay in sync by hand. They are pure functions with no React
// or DOM dependency, so they live here and are covered by tests/.

// Known ASR hallucination artifacts (subtitle-credit boilerplate) that speech
// models emit on silence — last-resort filter for anything that slips through.
export const HALLUCINATION_PATTERNS = [
  /редактор\s+субтитров/i,
  /корректор\s+[А-ЯA-Z]\./i,
  /продолжение\s+следует/i,
  /субтитры?\s+(сделал|создавал|делал|подготовил|редактировал|правил)/i,
  /спасибо\s+за\s+просмотр/i,
  /подписывайтесь/i,
  /dimatorzok/i,
  /amara\.org/i,
  /thanks?\s+for\s+watching/i,
  /subtitles?\s+by/i,
  /please\s+subscribe/i,
];

export function stripHallucinations(text) {
  if (!text) return '';
  const kept = text
    .split(/(?<=[.!?\n])\s+/)
    .map(s => s.trim())
    .filter(s => s && !HALLUCINATION_PATTERNS.some(re => re.test(s)));
  return kept.join(' ').trim();
}

// Parse a diarized transcript into per-utterance turns. Each block is either the
// new "[A 0:15] text" format (speaker + m:ss start time) or the older
// "Speaker A: text" format (no timestamp). Returns:
//   • null                → not diarized (plain transcript) — render raw text
//   • { turns, roleMap, multiSpeaker } → one turn per utterance, each with
//                           { speaker, time|null, text }
// Role labels use a heuristic: in therapy the client usually speaks more, so the
// speaker with the most total text becomes "Client" and the rest "Therapist".
export function parseSpeakerTurns(text) {
  if (!text) return null;
  const turns = [];
  for (const block of text.split('\n\n')) {
    let m = block.match(/^\[([A-Z0-9]+)\s+(\d{1,2}:\d{2})\]\s*([\s\S]*)$/); // new: [A 0:15] text
    if (m) { turns.push({ speaker: m[1], time: m[2], text: m[3].trim() }); continue; }
    m = block.match(/^Speaker ([A-Z0-9]+):\s*([\s\S]*)$/);                  // old sessions (no time)
    if (m) { turns.push({ speaker: m[1], time: null, text: m[2].trim() }); continue; }
    return null; // not diarized — bail to plain rendering
  }
  if (turns.length === 0) return null;
  const totals = {};
  for (const t of turns) totals[t.speaker] = (totals[t.speaker] || 0) + t.text.length;
  const speakers = Object.keys(totals);
  const client = speakers.reduce((a, b) => (totals[a] >= totals[b] ? a : b));
  const roleMap = {};
  for (const s of speakers) roleMap[s] = s === client ? 'Client' : 'Therapist';
  return { turns, roleMap, multiSpeaker: speakers.length >= 2 };
}

// Strip only the [0:15] timestamp from each "[A 0:15] text" block, keeping the
// speaker tag ("Speaker A: text") so the AI models still know who said what —
// important for therapy analysis — without the timestamp clutter. Old
// "Speaker A: text" blocks already lack a timestamp and pass through unchanged.
export function stripSpeakerMarkers(text) {
  if (!text) return '';
  return text
    .split('\n\n')
    .map(b => b.replace(/^\[([A-Z0-9]+)\s+\d{1,2}:\d{2}\]\s*/, 'Speaker $1: '))
    .join('\n\n');
}

// Format diarized utterances as "[<speaker> <m:ss>] text" blocks, stripping
// hallucination boilerplate PER-UTTERANCE so the \n\n block separators survive
// (stripHallucinations itself collapses newlines). Falls back to the flat text
// when diarization produced no utterances (short or near-silent audio).
export function formatUtterances(utterances, flatText) {
  const list = Array.isArray(utterances) ? utterances : [];
  const fmtMs = ms => {
    const s = Math.floor((ms || 0) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  if (list.length === 0) return stripHallucinations(flatText || '');
  return list
    .map(u => {
      const t = stripHallucinations(u.text || '');
      return t ? `[${u.speaker} ${fmtMs(u.start)}] ${t}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

// Cheap EN/RU heuristic: does recent session text skew Cyrillic or Latin?
// Robust against the "Speaker A:" Latin prefixes in diarized transcripts —
// a Russian session is overwhelmingly Cyrillic, so a few Latin tokens can't
// flip it. No sessions → default to English.
export function detectSessionLang(sessions) {
  if (!sessions?.length) return 'en';
  const sample = sessions.slice(0, 10).map(s => s.transcript || s.title || '').join(' ');
  const cyr = (sample.match(/[а-яё]/gi) || []).length;
  const lat = (sample.match(/[a-z]/gi) || []).length;
  return cyr > lat ? 'ru' : 'en';
}

export function groupSessions(list) {
  const today = new Date(); today.setHours(0,0,0,0);
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
  const g = { TODAY: [], THIS_WEEK: [], EARLIER: [] };
  for (const s of list) {
    const d = new Date(s.created_at); d.setHours(0,0,0,0);
    if (d.getTime() === today.getTime()) g.TODAY.push(s);
    else if (d >= weekAgo) g.THIS_WEEK.push(s);
    else g.EARLIER.push(s);
  }
  return g;
}
