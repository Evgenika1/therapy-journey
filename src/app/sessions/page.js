'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { sessions as sessionsApi, emotions as emotionsApi, aiChats, homework as homeworkApi } from '@/lib/api';

// ─── helpers ──────────────────────────────────────────────────────────────────
const SESSION_MOODS = [
  { emoji: '😞', intensity: 2 },
  { emoji: '😟', intensity: 4 },
  { emoji: '😐', intensity: 6 },
  { emoji: '🙂', intensity: 8 },
  { emoji: '😊', intensity: 10 },
];

function fmt(s) {
  if (!s) return '';
  const m = Math.floor(s / 60), sec = s % 60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

// "10:32 AM"
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// "23 sec" / "5 min" / "5 min 12 sec"
function fmtDuration(sec) {
  if (!sec) return '';
  if (sec < 60) return `${sec} sec`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m} min ${s} sec` : `${m} min`;
}

// Display title. Untitled sessions derive their name from created_at (the DB
// timestamp) — NOT the browser clock — so the date can't drift if the local
// machine's clock is wrong.
function sessionTitle(s) {
  if (s?.title) return s.title;
  return s?.created_at ? `Session ${new Date(s.created_at).toLocaleDateString()}` : 'Untitled';
}

const CHAT_SUGGESTIONS = {
  en: [
    'What emotions came up in my last session?',
    'Summarize the key themes across my sessions',
    'What patterns do you notice in my progress?',
    'What should I focus on for next session?',
  ],
  ru: [
    'Какие эмоции возникли на моей последней сессии?',
    'Резюмируй ключевые темы моих сессий',
    'Какие паттерны ты замечаешь в моём прогрессе?',
    'На чём мне стоит сосредоточиться на следующей сессии?',
  ],
};

// Empty-state chat panel copy, per language.
const CHAT_COPY = {
  en: { askSessions: 'Ask about your sessions', ask: t => `Ask about "${t}"`, tryOne: 'Try one of these to get started:' },
  ru: { askSessions: 'Спросите о своих сессиях',  ask: t => `Спросите о «${t}»`, tryOne: 'Попробуйте один из этих вопросов:' },
};

// Cheap EN/RU heuristic: does recent session text skew Cyrillic or Latin?
// Robust against the "Speaker A:" Latin prefixes in diarized transcripts —
// a Russian session is overwhelmingly Cyrillic, so a few Latin tokens can't
// flip it. No sessions → default to English.
function detectSessionLang(sessions) {
  if (!sessions?.length) return 'en';
  const sample = sessions.slice(0, 10).map(s => s.transcript || s.title || '').join(' ');
  const cyr = (sample.match(/[а-яё]/gi) || []).length;
  const lat = (sample.match(/[a-z]/gi) || []).length;
  return cyr > lat ? 'ru' : 'en';
}

// Silence detection. Whole-file mean RMS is the WRONG statistic — long therapy
// pauses dilute it below any threshold, so real speech reads as silent. Instead
// we look at the loudest ~1s window: if any second reaches speech-level energy,
// the recording is not silent. We only skip transcription when the windowed RMS
// AND the sample peak both indicate silence, so a genuinely quiet-but-real
// recording is never dropped — a false skip loses data, a false pass merely
// costs one API round-trip that returns empty.
const SPEECH_WINDOW_RMS  = 0.02;  // loudest ~1s window must reach this to be "speech"
const SILENCE_PEAK_FLOOR = 0.05;  // ...and no sample exceeds this → truly silent

// Known ASR hallucination artifacts (subtitle-credit boilerplate) that speech
// models emit on silence — last-resort filter for anything that slips through.
const HALLUCINATION_PATTERNS = [
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
function stripHallucinations(text) {
  if (!text) return '';
  const kept = text
    .split(/(?<=[.!?\n])\s+/)
    .map(s => s.trim())
    .filter(s => s && !HALLUCINATION_PATTERNS.some(re => re.test(s)));
  return kept.join(' ').trim();
}

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

// Parse a diarized transcript into per-utterance turns. Each block is either the
// new "[A 0:15] text" format (speaker + m:ss start time) or the older
// "Speaker A: text" format (no timestamp). Returns:
//   • null                → not diarized (plain transcript) — render raw text
//   • { turns, roleMap, multiSpeaker } → one turn per utterance, each with
//                           { speaker, time|null, text }
// Role labels use a heuristic: in therapy the client usually speaks more, so the
// speaker with the most total text becomes "Client" and the rest "Therapist".
function parseSpeakerTurns(text) {
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
function stripSpeakerMarkers(text) {
  if (!text) return '';
  return text
    .split('\n\n')
    .map(b => b.replace(/^\[([A-Z0-9]+)\s+\d{1,2}:\d{2}\]\s*/, 'Speaker $1: '))
    .join('\n\n');
}

// Lightweight VU-meter shown during recording. Passive AnalyserNode tap on the
// MediaRecorder stream — source.connect(analyser) only, NEVER connected to
// destination, so it cannot alter the recorded signal. Uses requestAnimationFrame
// (not setInterval, so it doesn't touch the recording timer) and lives in its own
// component so the ~60fps updates don't re-render the whole page.
function AudioLevelMeter({ stream, A, MUTED, TEXT }) {
  const [bars, setBars] = useState(() => new Array(9).fill(0));
  useEffect(() => {
    if (!stream) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64; // tiny — 32 bins
    source.connect(analyser); // passive tap — analyser is NOT connected onward
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      setBars(Array.from({ length: 9 }, (_, i) => data[i * 2] / 255));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      try { source.disconnect(); } catch {}
      try { ctx.close(); } catch {}
    };
  }, [stream]);
  const active = bars.some(b => b > 0.08);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 40 }}>
        {bars.map((b, i) => (
          <div key={i} style={{ width: 5, height: Math.max(6, b * 40), background: A, borderRadius: 3, transition: 'height 0.06s linear' }} />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: active ? A : MUTED, transition: 'background 0.2s' }} />
        <span style={{ fontSize: 12.5, color: active ? TEXT : MUTED, fontWeight: 500 }}>{active ? 'Hearing your voice' : 'Listening…'}</span>
      </div>
    </div>
  );
}

function groupSessions(list) {
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

function parseAI(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return { overview: raw }; }
}

// ─── Main component ────────────────────────────────────────────────────────────
function SessionsPageInner() {
  const { supabase, user } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL: A } = useTheme();
  const searchParams = useSearchParams();
  const router = useRouter();

  // sessions list
  const [sessions,        setSessions]        = useState([]);
  const sessionLang = detectSessionLang(sessions);
  const [loading,         setLoading]         = useState(true);
  const [searchQuery,     setSearchQuery]     = useState('');
  const [selectedSession, setSelectedSession] = useState(null);
  const [activeTab,       setActiveTab]       = useState('summary');
  const [sessionNotes,    setSessionNotes]    = useState('');
  const [savingNotes,     setSavingNotes]     = useState(false);
  const [analysing,       setAnalysing]       = useState(false);
  const [analyseError,    setAnalyseError]    = useState('');

  // recording modal
  const [showModal,          setShowModal]          = useState(false);
  const [isCapturing,        setIsCapturing]        = useState(false);
  const [isTranscribing,     setIsTranscribing]     = useState(false);
  const [isReview,           setIsReview]           = useState(false);
  const [seconds,            setSeconds]            = useState(0);
  const [transcript,         setTranscript]         = useState('');
  const [recNotes,           setRecNotes]           = useState('');
  const [saving,             setSaving]             = useState(false);
  const [saved,              setSaved]              = useState(false);
  const [showPreMood,        setShowPreMood]        = useState(false);
  const [preRecordMoodIdx,   setPreRecordMoodIdx]   = useState(null);
  const [postRecordMoodIdx,  setPostRecordMoodIdx]  = useState(null);
  const [postMoodSaved,      setPostMoodSaved]      = useState(false);
  const [savingMood,         setSavingMood]         = useState(false);
  const [speechError,        setSpeechError]        = useState('');
  const [saveError,          setSaveError]          = useState('');

  // right panel chat
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput,    setChatInput]    = useState('');
  const [chatLoading,  setChatLoading]  = useState(false);
  const [sessionChatId, setSessionChatId] = useState(null);
  const [attachContext, setAttachContext] = useState(true);
  const chatBottomRef = useRef(null);

  const timerRef       = useRef(null);
  const mediaRef       = useRef(null);
  const chunksRef      = useRef([]);
  const startGuardRef  = useRef(false); // sync re-entry guard — survives the getUserMedia await
  const recordParamHandled = useRef(false); // one-shot for the ?record=true auto-open effect

  // Live captions during recording were removed: AssemblyAI's v3 realtime stream
  // is English-only (garbage on Russian) and its output was always discarded, and
  // tapping the mic with a second AudioContext risked corrupting the recording.
  // The batch transcript produced after Stop is the source of truth.

  // ── load sessions ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    sessionsApi.list(supabase)
      .then(d => { setSessions(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [supabase]);

  // ── auto-open record modal from URL param ────────────────────────────────────
  useEffect(() => {
    if (recordParamHandled.current) return; // Strict Mode double-invokes effects on mount
    if (searchParams.get('record') === 'true') {
      recordParamHandled.current = true;
      const preMoodParam = searchParams.get('preMood');
      openRecordModal(preMoodParam !== null ? Number(preMoodParam) : undefined);
      router.replace('/sessions');
    }
  }, [searchParams]);

  // ── scroll chat to bottom ────────────────────────────────────────────────────
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── select session ────────────────────────────────────────────────────────────
  function selectSession(s) {
    setSelectedSession(s);
    setActiveTab('summary');
    setSessionNotes(s.notes || '');
    setChatMessages([]);
    setSessionChatId(null);
  }

  // ── load persisted chat for selected session ─────────────────────────────────
  useEffect(() => {
    if (!supabase || !selectedSession) return;
    let cancelled = false;
    aiChats.forSession(supabase, selectedSession.id).then(chat => {
      if (cancelled || !chat) return;
      setSessionChatId(chat.id);
      setChatMessages(Array.isArray(chat.messages) ? chat.messages : []);
    }).catch(e => console.error('[Sessions] load chat:', e?.message));
    return () => { cancelled = true; };
  }, [supabase, selectedSession?.id]);

  // ── filtered sessions ─────────────────────────────────────────────────────────
  const filtered = sessions.filter(s => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (s.title || '').toLowerCase().includes(q)
      || (s.transcript || '').toLowerCase().includes(q)
      || (s.notes || '').toLowerCase().includes(q);
  });
  const grouped = groupSessions(filtered);

  // ── recording ────────────────────────────────────────────────────────────────
  function openRecordModal(preMoodIntensity) {
    setShowModal(true);
    setSpeechError('');
    setTranscript('');
    setRecNotes('');
    chunksRef.current = [];
    // preMoodIntensity is set when navigating here from the Dashboard, which
    // already saved the "before" mood — skip re-asking/re-saving it here.
    if (typeof preMoodIntensity === 'number') {
      const idx = SESSION_MOODS.findIndex(m => m.intensity === preMoodIntensity);
      setPreRecordMoodIdx(idx >= 0 ? idx : null);
      setShowPreMood(false);
      startRecording();
    } else {
      setShowPreMood(true);
      setPreRecordMoodIdx(null);
    }
  }

  function closeModal() {
    if (isCapturing) stopRecording();
    clearInterval(timerRef.current);
    setShowModal(false); setIsCapturing(false); setIsTranscribing(false); setIsReview(false);
    setSeconds(0); setTranscript(''); setRecNotes(''); setSaved(false);
    setShowPreMood(false); setPreRecordMoodIdx(null);
    setPostRecordMoodIdx(null); setPostMoodSaved(false);
    setSpeechError(''); setSaveError('');
    chunksRef.current = [];
  }

  async function startAfterPreMood() {
    if (preRecordMoodIdx !== null && user) {
      try { await emotionsApi.save(supabase, { category: 'Session', emotion_name: 'Before', intensity: SESSION_MOODS[preRecordMoodIdx].intensity, session_tag: 'before' }); }
      catch(e) { console.error('[Sessions] pre-mood:', e?.message); }
    }
    setShowPreMood(false);
    startRecording();
  }

  async function startRecording() {
    // Re-entry guard, set synchronously BEFORE any await. A second call during
    // the getUserMedia await (Strict Mode / double-fired handler) would otherwise
    // stack a second MediaRecorder + AudioContext + interval on the shared refs —
    // interleaving two bitstreams into one blob (garbled audio) and running two
    // timers (erratic counter). mediaRef.current is set post-await, too late to
    // guard on its own.
    if (startGuardRef.current || mediaRef.current) return;
    startGuardRef.current = true;
    setSpeechError(''); setTranscript('');
    chunksRef.current = [];

    let stream;
    try {
      // Audio-processing constraints tuned for the built-in mic: echoCancellation
      // and noiseSuppression OFF (Chrome's AEC distorted capture into noise, and NS
      // gated quiet speech toward silence); autoGainControl ON to lift the quiet
      // far-field signal.
      stream = await navigator.mediaDevices.getUserMedia({ audio: {
        noiseSuppression: false,
        autoGainControl: true,
        echoCancellation: false,
      } });
    }
    catch { setSpeechError('Microphone access denied.'); startGuardRef.current = false; return; }

    const mimeType = getSupportedMimeType();
    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRef.current = mr;
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onerror = (e) => { setSpeechError('Recording error: ' + (e?.error?.message || 'unknown')); clearInterval(timerRef.current); setIsCapturing(false); };
    mr.start(1000);
    setIsCapturing(true); setSeconds(0);
    clearInterval(timerRef.current); // defensive: never leave a stale interval running
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    startGuardRef.current = false; // setup complete — mediaRef.current now guards re-entry
  }

  async function stopRecording() {
    clearInterval(timerRef.current);
    setIsCapturing(false);
    if (!mediaRef.current) return;

    await new Promise(resolve => { mediaRef.current.onstop = resolve; mediaRef.current.stop(); });
    mediaRef.current.stream.getTracks().forEach(t => t.stop());

    const mimeType = mediaRef.current.mimeType || 'audio/webm';
    const chunks = chunksRef.current.slice();
    mediaRef.current = null;
    const audioBlob = new Blob(chunks, { type: mimeType });
    console.log('[Recording] mimeType:', mimeType, 'chunks:', chunks.length, 'size:', audioBlob.size, 'bytes');

    if (audioBlob.size < 1000) {
      setSpeechError(`Recording too short (${chunks.length} chunks, ${audioBlob.size} bytes).`);
      setIsReview(true); return;
    }

    // Silence detection: measure the loudest ~1s window of the recorded audio.
    // A whole-file mean would be diluted by pauses, so we take the loudest window.
    let loudestWindowRms = null, peak = 0;
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await ac.decodeAudioData(await audioBlob.arrayBuffer());
      const ch = decoded.getChannelData(0);
      const win = Math.max(1, Math.floor(decoded.sampleRate)); // ~1s window
      loudestWindowRms = 0;
      for (let start = 0; start < ch.length; start += win) {
        const end = Math.min(start + win, ch.length);
        let sumSq = 0;
        for (let i = start; i < end; i++) { const a = Math.abs(ch[i]); sumSq += a * a; if (a > peak) peak = a; }
        const wRms = Math.sqrt(sumSq / (end - start));
        if (wRms > loudestWindowRms) loudestWindowRms = wRms;
      }
      ac.close();
    } catch { /* decode failed — skip the guard and let the server decide */ }

    // Silence guard — skip /api/transcribe only when BOTH signals agree it's silent.
    if (loudestWindowRms !== null && loudestWindowRms < SPEECH_WINDOW_RMS && peak < SILENCE_PEAK_FLOOR) {
      setTranscript('');
      setSpeechError('No speech detected — the recording was silent. You can type manually.');
      setIsReview(true);
      return;
    }

    setIsTranscribing(true);
    try {
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      const form = new FormData();
      form.append('audio', audioBlob, `recording.${ext}`);
      form.append('language', navigator.language.slice(0, 2));
      const res = await fetch('/api/transcribe', { method: 'POST', body: form });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // The server already strips hallucination boilerplate (per-utterance when
      // the audio is diarized), so use its text verbatim — re-stripping here
      // would collapse the "Speaker A:" block separators into one paragraph.
      const finalText = data.text || '';
      setTranscript(finalText);
      if (!finalText) setSpeechError('No speech detected in the recording.');
    } catch (err) {
      console.error('[transcribe]', err);
      setSpeechError('Transcription error: ' + err.message);
      setTranscript('');
    } finally {
      setIsTranscribing(false); setIsReview(true);
    }
  }

  async function savePostMood() {
    if (postRecordMoodIdx === null) return;
    if (!user) { setPostMoodSaved(true); return; }
    setSavingMood(true);
    try { await emotionsApi.save(supabase, { category: 'Session', emotion_name: 'After', intensity: SESSION_MOODS[postRecordMoodIdx].intensity, session_tag: 'after' }); setPostMoodSaved(true); }
    catch(e) { console.error('[Sessions] post-mood:', e?.message); }
    finally { setSavingMood(false); }
  }

  async function saveSession() {
    if (!user) { setSaveError('Not signed in.'); return; }
    setSaving(true); setSaveError('');
    try {
      console.log('[Sessions] saving, transcript length:', transcript?.length);
      const result = await sessionsApi.save(supabase, {
        title:    recNotes.slice(0, 60) || null, // untitled → derive from created_at at display (sessionTitle)
        transcript, notes: recNotes, duration: seconds,
        mood_before: preRecordMoodIdx  !== null ? SESSION_MOODS[preRecordMoodIdx].intensity  : null,
        mood_after:  postRecordMoodIdx !== null ? SESSION_MOODS[postRecordMoodIdx].intensity : null,
      });
      setSessions(s => [result, ...s]);
      setSaved(true);
      setTimeout(() => { closeModal(); setSelectedSession(result); }, 1500);
    } catch (err) {
      console.error('[Sessions] save error:', err?.message, err?.code);
      setSaveError('Failed to save: ' + (err?.message || 'unknown'));
    } finally { setSaving(false); }
  }

  // ── analyse session ──────────────────────────────────────────────────────────
  async function analyseSession() {
    if (!selectedSession || analysing) return;
    setAnalysing(true); setAnalyseError('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: stripSpeakerMarkers(selectedSession.transcript), notes: selectedSession.notes }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // Save to Supabase
      const updated = await sessionsApi.update(supabase, selectedSession.id, { ai_analysis: JSON.stringify(data.analysis) });
      const withAI = { ...selectedSession, ai_analysis: JSON.stringify(data.analysis) };
      setSelectedSession(withAI);
      setSessions(list => list.map(s => s.id === selectedSession.id ? { ...s, ai_analysis: JSON.stringify(data.analysis) } : s));

      if (data.analysis?.action) {
        try {
          const existing = await homeworkApi.forSession(supabase, selectedSession.id);
          if (!existing) {
            await homeworkApi.save(supabase, {
              title:       data.analysis.action.slice(0, 120),
              description: `Auto-created from AI analysis of "${selectedSession.title || 'this session'}".`,
              session_id:  selectedSession.id,
              due_date:    null,
            });
          }
        } catch (e) { console.error('[Sessions] auto-homework:', e?.message); }
      }
    } catch (err) {
      console.error('[analyse]', err);
      setAnalyseError(err.message);
    } finally { setAnalysing(false); }
  }

  // ── notes save ───────────────────────────────────────────────────────────────
  async function saveNotes() {
    if (!selectedSession || !user) return;
    setSavingNotes(true);
    try {
      await sessionsApi.update(supabase, selectedSession.id, { notes: sessionNotes });
      setSelectedSession(s => ({ ...s, notes: sessionNotes }));
      setSessions(list => list.map(s => s.id === selectedSession.id ? { ...s, notes: sessionNotes } : s));
    } catch(e) { console.error('[Sessions] notes save:', e?.message); }
    finally { setSavingNotes(false); }
  }

  // ── delete session ───────────────────────────────────────────────────────────
  async function deleteSession(s) {
    if (!confirm(`Delete "${s.title || 'this session'}"?`)) return;
    try {
      await sessionsApi.delete(supabase, s.id);
      setSessions(list => list.filter(x => x.id !== s.id));
      if (selectedSession?.id === s.id) setSelectedSession(null);
    } catch (err) {
      console.error('[Sessions] delete error:', err?.message, err?.code);
      alert('Failed to delete: ' + (err?.message || 'unknown error'));
    }
  }

  // ── AI chat ──────────────────────────────────────────────────────────────────
  async function sendChat(text) {
    const msg = (text || chatInput).trim();
    if (!msg || chatLoading) return;
    setChatInput('');
    const next = [...chatMessages, { role: 'user', content: msg }];
    setChatMessages(next);
    setChatLoading(true);
    try {
      const includeCtx = attachContext && selectedSession?.transcript;
      const langRule = sessionLang === 'ru' ? ' Always respond in Russian.' : ' Always respond in English.';
      const systemPrompt = (includeCtx
        ? `You are a compassionate AI therapy companion. The user is reviewing a therapy session.\n\nSession transcript:\n"${stripSpeakerMarkers(selectedSession.transcript).slice(0, 3000)}"\n\nBe concise, warm, and insightful.`
        : 'You are a compassionate AI therapy companion. Be concise, warm, and insightful.') + langRule;
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, systemPrompt }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const final = [...next, { role: 'assistant', content: data.content }];
      setChatMessages(final);

      if (selectedSession) {
        try {
          if (!sessionChatId) {
            const chat = await aiChats.create(supabase, selectedSession.title || 'Session chat', final, selectedSession.id);
            setSessionChatId(chat.id);
          } else {
            await aiChats.update(supabase, sessionChatId, final);
          }
        } catch (e) { console.error('[Sessions] save chat:', e?.message); }
      }
    } catch(err) {
      setChatMessages([...next, { role: 'assistant', content: '⚠ ' + err.message }]);
    } finally { setChatLoading(false); }
  }

  // ── copy summary ─────────────────────────────────────────────────────────────
  function copySummary() {
    if (!selectedSession) return;
    const ai = parseAI(selectedSession.ai_analysis);
    const text = ai
      ? [ai.overview, ai.key_theme, ai.breakthrough, ai.action].filter(Boolean).join('\n\n')
      : selectedSession.transcript || '';
    navigator.clipboard.writeText(text).catch(() => {});
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden', position: 'relative' }}>

        {/* ── LEFT COLUMN ─────────────────────────────────────────────────────── */}
        <div style={{ width: 340, flexShrink: 0, borderRight: `1px solid ${BORDER}`, background: SURFACE, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Search */}
          <div style={{ padding: '16px 14px 10px' }}>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search conversations…"
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 9, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
              onFocus={e => e.target.style.borderColor = A}
              onBlur={e  => e.target.style.borderColor = BORDER}
            />
          </div>

          {/* Import + Record */}
          <div style={{ padding: '0 14px 12px', display: 'flex', gap: 8 }}>
            <button style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
              ↑ Import
            </button>
            <button onClick={openRecordModal}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: '#C4687A', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="3.5" fill="white" opacity="0.35"/><circle cx="5" cy="5" r="2" fill="white"/></svg>
              Record
            </button>
          </div>

          {/* Session list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 16px' }}>
            {loading && <p style={{ fontSize: 12, color: MUTED, padding: '8px 6px' }}>Loading…</p>}
            {!loading && filtered.length === 0 && <p style={{ fontSize: 12, color: MUTED, padding: '8px 6px' }}>No sessions yet.</p>}

            {[['TODAY', grouped.TODAY], ['THIS WEEK', grouped.THIS_WEEK], ['EARLIER', grouped.EARLIER]].map(([label, list]) => (
              list.length > 0 && (
                <div key={label}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: MUTED, margin: '18px 6px 8px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</p>
                  {list.map(s => {
                    const active = selectedSession?.id === s.id;
                    return (
                      <div key={s.id} onClick={() => selectSession(s)}
                        style={{ padding: '12px 14px', borderRadius: 12, marginBottom: 8, cursor: 'pointer', background: active ? A + '12' : BG, border: `1px solid ${active ? A + '55' : BORDER}`, transition: 'border-color 0.12s, background 0.12s' }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = A + '40'; }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = BORDER; }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          {s.ai_analysis && (
                            <div title="AI analysis available" style={{ width: 6, height: 6, borderRadius: '50%', background: '#8B5CF6', flexShrink: 0 }} />
                          )}
                          <p style={{ fontSize: 14, fontWeight: 600, color: active ? A : TEXT, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {sessionTitle(s)}
                          </p>
                        </div>
                        <p style={{ fontSize: 11.5, color: MUTED, margin: '0 0 6px', fontWeight: 500 }}>
                          {fmtTime(s.created_at)}
                          {s.duration ? ` · ${fmtDuration(s.duration)}` : ''}
                        </p>
                        {s.transcript && (
                          <p style={{ fontSize: 12, color: MUTED, margin: 0, lineHeight: 1.5, opacity: 0.85, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {s.transcript}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            ))}
          </div>
        </div>

        {/* ── CENTER COLUMN ───────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', background: BG }}>
          {showModal ? (
            /* ── EMBEDDED RECORDING SECTION (replaces the old modal overlay) ─────── */
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: 28 }}>
              <div style={{ width: '100%', maxWidth: isReview ? 720 : 560, height: 'fit-content', background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 32 }}>
                {/* Pre-mood */}
                {showPreMood && !isCapturing && (
                  <>
                    <p style={{ fontFamily: '"Fraunces", serif', fontSize: 22, fontWeight: 300, color: TEXT, margin: '0 0 6px' }}>How are you feeling?</p>
                    <p style={{ fontSize: 13, color: MUTED, margin: '0 0 24px' }}>Before starting the session</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 28 }}>
                      {SESSION_MOODS.map((m, i) => (
                        <button key={i} onClick={() => setPreRecordMoodIdx(i)}
                          style={{ width: 48, height: 48, boxSizing: 'border-box', flexShrink: 0, borderRadius: 12, border: `2px solid ${preRecordMoodIdx === i ? A : BORDER}`, background: preRecordMoodIdx === i ? A + '18' : 'transparent', fontSize: 24, cursor: 'pointer' }}>
                          {m.emoji}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button onClick={closeModal} style={{ flex: 1, padding: 11, borderRadius: 12, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={() => { setShowPreMood(false); startRecording(); }} style={{ flex: 1, padding: 11, borderRadius: 12, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 14, cursor: 'pointer' }}>Skip</button>
                      <button onClick={startAfterPreMood} style={{ flex: 2, padding: 11, borderRadius: 12, border: 'none', background: A, color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Start Recording</button>
                    </div>
                  </>
                )}

                {/* Transcribing */}
                {isTranscribing && (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <div style={{ width: 44, height: 44, border: `3px solid ${BORDER}`, borderTop: `3px solid ${A}`, borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
                    <p style={{ fontSize: 16, color: TEXT, margin: 0 }}>Transcribing…</p>
                    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                  </div>
                )}

                {/* Capturing */}
                {isCapturing && !isTranscribing && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#EF4444', animation: 'pulse 1s infinite' }} />
                        <span style={{ fontSize: 13, fontWeight: 500, color: '#EF4444' }}>Recording</span>
                      </div>
                      <span style={{ fontFamily: '"Fraunces", serif', fontSize: 28, fontWeight: 300, color: TEXT }}>{fmt(seconds)}</span>
                      <button onClick={stopRecording} style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: '#EF4444', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>⏹ Stop</button>
                    </div>
                    <div style={{ minHeight: 90, padding: '16px 14px', borderRadius: 10, background: BG, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <AudioLevelMeter stream={mediaRef.current?.stream} A={A} MUTED={MUTED} TEXT={TEXT} />
                    </div>
                    <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
                  </>
                )}

                {/* Review */}
                {isReview && !isCapturing && !isTranscribing && (
                  <>
                    <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Review · {fmt(seconds)}</p>

                    {!postMoodSaved && (
                      <div style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
                        <p style={{ fontSize: 13, fontWeight: 500, color: TEXT, margin: '0 0 10px' }}>How do you feel now?</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                          {SESSION_MOODS.map((m, i) => (
                            <button key={i} onClick={() => setPostRecordMoodIdx(i)}
                              style={{ width: 38, height: 38, boxSizing: 'border-box', flexShrink: 0, borderRadius: 9, border: `2px solid ${postRecordMoodIdx === i ? A : BORDER}`, background: postRecordMoodIdx === i ? A + '18' : 'transparent', fontSize: 20, cursor: 'pointer' }}>
                              {m.emoji}
                            </button>
                          ))}
                        </div>
                        <button onClick={savePostMood} disabled={postRecordMoodIdx === null || savingMood}
                          style={{ padding: '7px 16px', borderRadius: 9, border: 'none', background: postRecordMoodIdx !== null ? A : BORDER, color: '#fff', fontSize: 12, fontWeight: 500, cursor: postRecordMoodIdx !== null ? 'pointer' : 'default' }}>
                          {savingMood ? 'Saving…' : 'Save mood'}
                        </button>
                      </div>
                    )}

                    <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Transcript</p>
                    {speechError && <p style={{ fontSize: 12, color: A, margin: '0 0 6px' }}>{speechError}</p>}
                    <textarea value={transcript} onChange={e => setTranscript(e.target.value)}
                      placeholder="No transcript — you can type manually"
                      style={{ width: '100%', boxSizing: 'border-box', minHeight: 240, padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.7, marginBottom: 12 }} />

                    <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Notes</p>
                    <textarea value={recNotes} onChange={e => setRecNotes(e.target.value)}
                      placeholder="Add notes…"
                      style={{ width: '100%', boxSizing: 'border-box', minHeight: 60, padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.7, marginBottom: 16 }} />

                    {saveError && <p style={{ fontSize: 12, color: '#DC2626', margin: '0 0 10px' }}>⚠ {saveError}</p>}
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button onClick={closeModal} style={{ flex: 1, padding: 11, borderRadius: 11, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 13, cursor: 'pointer' }}>Discard</button>
                      <button onClick={saveSession} disabled={saving || saved}
                        style={{ flex: 2, padding: 11, borderRadius: 11, border: 'none', background: saved ? '#15803D' : A, color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                        {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Session'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : !selectedSession ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.2"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              <p style={{ fontSize: 15, color: MUTED, margin: 0 }}>Select a session to view details</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={{ padding: '20px 28px 0', borderBottom: `1px solid ${BORDER}`, background: SURFACE }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 600, color: TEXT, margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sessionTitle(selectedSession)}
                    </h2>
                    <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>
                      {new Date(selectedSession.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                      {selectedSession.duration ? ` · ${fmt(selectedSession.duration)}` : ''}
                      {selectedSession.mood_before != null && selectedSession.mood_after != null
                        ? ` · Mood ${selectedSession.mood_before}/10 → ${selectedSession.mood_after}/10` : ''}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 16 }}>
                    <button onClick={copySummary}
                      style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 12, cursor: 'pointer' }}>
                      Copy summary
                    </button>
                    <button onClick={() => deleteSession(selectedSession)}
                      style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 14, cursor: 'pointer' }}>
                      🗑️
                    </button>
                  </div>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: 0 }}>
                  {['summary', 'transcript', 'notes'].map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                      style={{ padding: '9px 18px', border: 'none', background: 'transparent', fontSize: 13, fontWeight: activeTab === tab ? 600 : 400, color: activeTab === tab ? A : MUTED, cursor: 'pointer', borderBottom: activeTab === tab ? `2px solid ${A}` : '2px solid transparent', marginBottom: -1, textTransform: 'capitalize' }}>
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab content */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 28 }}>

                {/* Summary tab */}
                {activeTab === 'summary' && (() => {
                  const ai = parseAI(selectedSession.ai_analysis);
                  if (!ai) return (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14 }}>
                      <p style={{ fontSize: 15, color: MUTED, margin: 0, textAlign: 'center' }}>No AI analysis yet</p>
                      {analyseError && <p style={{ fontSize: 12, color: '#DC2626', margin: 0, textAlign: 'center' }}>{analyseError}</p>}
                      <button onClick={analyseSession} disabled={analysing || !selectedSession?.transcript}
                        style={{ padding: '11px 28px', borderRadius: 12, border: 'none', background: selectedSession?.transcript ? A : BORDER, color: '#fff', fontSize: 14, fontWeight: 500, cursor: selectedSession?.transcript ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 8 }}>
                        {analysing ? '⏳ Analysing…' : '✦ Analyse'}
                      </button>
                      {!selectedSession?.transcript && <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>Session needs a transcript to analyse</p>}
                    </div>
                  );
                  const SECTIONS = [
                    { key: 'topics_covered',              label: 'TOPICS COVERED',      color: '#0EA5E9' },
                    { key: 'overview',                    label: 'OVERVIEW',            color: '#3B82F6' },
                    { key: 'key_theme',                   label: 'KEY THEME',           color: '#8B5CF6' },
                    { key: 'breakthroughs',               label: 'BREAKTHROUGHS',       color: '#10B981' },
                    { key: 'emotions_identified',         label: 'EMOTIONS IDENTIFIED', color: '#EC4899' },
                    { key: 'action_items',                label: 'ACTION ITEMS',        color: '#F59E0B' },
                    { key: 'patterns_triggers',           label: 'PATTERNS / TRIGGERS', color: '#EF4444' },
                    { key: 'continuity_notes',            label: 'CONTINUITY NOTES',    color: '#14B8A6' },
                    { key: 'for_next_session',            label: 'FOR NEXT SESSION',    color: '#6366F1' },
                    { key: 'emotional_intensity_markers', label: 'EMOTIONAL INTENSITY', color: '#DC2626' },
                    // legacy keys from analyses generated before the 10-section rewrite
                    { key: 'breakthrough',                label: 'BREAKTHROUGH',        color: '#10B981' },
                    { key: 'action',                      label: 'ACTION',              color: '#F59E0B' },
                  ];
                  const hasVal = v => Array.isArray(v) ? v.length > 0 : (v != null && String(v).trim() !== '');
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                        {analyseError && <span style={{ fontSize: 12, color: '#DC2626' }}>{analyseError}</span>}
                        <button onClick={analyseSession} disabled={analysing}
                          style={{ padding: '6px 14px', borderRadius: 9, border: `1px solid ${BORDER}`, background: 'transparent', color: analysing ? MUTED : A, fontSize: 12.5, fontWeight: 500, cursor: analysing ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {analysing ? '⏳ Re-analysing…' : '↻ Re-analyze'}
                        </button>
                      </div>
                      {SECTIONS.filter(({ key }) => hasVal(ai[key])).map(({ key, label, color }) => (
                        <div key={key} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${color}`, borderRadius: 12, padding: '16px 18px' }}>
                          <p style={{ fontSize: 10, fontWeight: 700, color, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</p>
                          {Array.isArray(ai[key])
                            ? <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {ai[key].map((item, i) => (
                                  <li key={i} style={{ fontSize: 14, color: TEXT, lineHeight: 1.6 }}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
                                ))}
                              </ul>
                            : <p style={{ fontSize: 14, color: TEXT, margin: 0, lineHeight: 1.7 }}>{ai[key]}</p>}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Transcript tab */}
                {activeTab === 'transcript' && (() => {
                  if (!selectedSession.transcript)
                    return <p style={{ fontSize: 14, color: MUTED }}>No transcript for this session.</p>;
                  const parsed = parseSpeakerTurns(selectedSession.transcript);
                  if (!parsed)
                    return <p style={{ fontSize: 14, color: TEXT, lineHeight: 1.9, whiteSpace: 'pre-wrap', margin: 0 }}>{selectedSession.transcript}</p>;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {parsed.turns.map((turn, i) => {
                        const role = parsed.roleMap[turn.speaker];
                        // Warm on-brand palette: terracotta for the primary speaker,
                        // muted taupe for the second — no off-palette colors.
                        const badgeColor = role === 'Client' ? A : MUTED;
                        const label = parsed.multiSpeaker ? role : `Speaker ${turn.speaker}`;
                        return (
                          <div key={i} style={{ display: 'flex', gap: 12, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px' }}>
                            <div style={{ width: 30, height: 30, flexShrink: 0, borderRadius: '50%', background: badgeColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
                              {turn.speaker}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                                <span style={{ fontSize: 12.5, fontWeight: 600, color: TEXT }}>{label}</span>
                                {turn.time && <span style={{ fontSize: 11.5, color: MUTED }}>{turn.time}</span>}
                              </div>
                              <p style={{ fontSize: 14, color: TEXT, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>{turn.text}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Notes tab */}
                {activeTab === 'notes' && (
                  <div>
                    <textarea value={sessionNotes} onChange={e => setSessionNotes(e.target.value)}
                      placeholder="Add notes about this session…"
                      style={{ width: '100%', boxSizing: 'border-box', minHeight: 280, padding: '14px 16px', borderRadius: 12, border: `1px solid ${BORDER}`, background: SURFACE, color: TEXT, fontSize: 14, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.8 }} />
                    <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                      <button onClick={saveNotes} disabled={savingNotes}
                        style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: A, color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                        {savingNotes ? 'Saving…' : 'Save notes'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── RIGHT COLUMN ────────────────────────────────────────────────────── */}
        <div style={{ width: 320, flexShrink: 0, borderLeft: `1px solid ${BORDER}`, background: SURFACE, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header — New chat */}
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${BORDER}` }}>
            <button onClick={() => { setChatMessages([]); setSessionChatId(null); }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 0', borderRadius: 10, border: `1px solid ${BORDER}`, background: BG, color: A, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = A + '55'}
              onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={A} strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New chat
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px' }}>
            {chatMessages.length === 0 && (
              <div style={{ padding: '8px 2px' }}>
                <p style={{ fontSize: 13, color: TEXT, fontWeight: 600, margin: '0 0 4px' }}>
                  {selectedSession
                    ? CHAT_COPY[sessionLang].ask(selectedSession.title || (sessionLang === 'ru' ? 'этой сессии' : 'this session'))
                    : CHAT_COPY[sessionLang].askSessions}
                </p>
                <p style={{ fontSize: 12, color: MUTED, margin: '0 0 16px', lineHeight: 1.6 }}>
                  {CHAT_COPY[sessionLang].tryOne}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {CHAT_SUGGESTIONS[sessionLang].map(q => (
                    <button key={q} onClick={() => sendChat(q)} disabled={chatLoading}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', borderRadius: 11, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 12.5, lineHeight: 1.4, cursor: 'pointer', textAlign: 'left' }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = A + '55'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}>
                      <span style={{ fontSize: 14, flexShrink: 0 }}>✦</span>
                      <span>{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {chatMessages.map((m, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '85%', padding: '9px 13px', fontSize: 13, lineHeight: 1.6,
                    borderRadius: m.role === 'user' ? '14px 14px 3px 14px' : '14px 14px 14px 3px',
                    background: m.role === 'user' ? A : BG,
                    color: m.role === 'user' ? '#fff' : TEXT,
                    border: m.role === 'user' ? 'none' : `1px solid ${BORDER}`,
                  }}>
                    {m.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ display: 'flex' }}>
                  <div style={{ padding: '9px 13px', borderRadius: '14px 14px 14px 3px', background: BG, border: `1px solid ${BORDER}`, color: MUTED, fontSize: 13 }}>…</div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>
          </div>

          {/* Input */}
          <div style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER}` }}>
            {/* Add-context chip */}
            <div style={{ marginBottom: 8 }}>
              {selectedSession ? (
                <button onClick={() => setAttachContext(v => !v)}
                  title={attachContext ? 'Session transcript is attached as context — click to detach' : 'Click to attach this session as context'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', padding: '5px 10px', borderRadius: 8, border: `1px solid ${attachContext ? A + '55' : BORDER}`, background: attachContext ? A + '12' : BG, color: attachContext ? A : MUTED, fontSize: 11.5, fontWeight: 500, cursor: 'pointer' }}>
                  <span style={{ flexShrink: 0 }}>{attachContext ? '📎' : '＋'}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {attachContext ? (selectedSession.title || 'This session') : 'Add context'}
                  </span>
                  {attachContext && <span style={{ flexShrink: 0, opacity: 0.7 }}>✕</span>}
                </button>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, border: `1px dashed ${BORDER}`, color: MUTED, fontSize: 11.5 }}>
                  ＋ Add context — select a session
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                placeholder="Ask anything about your conversations…"
                style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 12, outline: 'none', fontFamily: 'inherit' }}
                onFocus={e => e.target.style.borderColor = A}
                onBlur={e  => e.target.style.borderColor = BORDER}
              />
              <button onClick={() => sendChat()} disabled={!chatInput.trim() || chatLoading}
                style={{ padding: '9px 14px', borderRadius: 10, border: 'none', background: chatInput.trim() ? A : BORDER, color: '#fff', fontSize: 12, fontWeight: 500, cursor: chatInput.trim() ? 'pointer' : 'default' }}>
                ↑
              </button>
            </div>
          </div>
        </div>

      </div>
    </AppLayout>
  );
}

export default function SessionsPage() {
  return (
    <Suspense>
      <SessionsPageInner />
    </Suspense>
  );
}
