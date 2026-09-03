'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { sessions as sessionsApi, emotions as emotionsApi, aiChats, homework as homeworkApi } from '@/lib/api';
import { ALLOWED_EXT, MAX_UPLOAD_BYTES, extOf, tooLargeMessage, unsupportedTypeMessage } from '@/lib/audioUpload';
import { savePendingRecording, loadPendingRecording, clearPendingRecording } from '@/lib/recordingStore';
import {
  uploadForTranscription, pollTranscript,
  rememberPendingJob, forgetPendingJob, loadPendingJob,
} from '@/lib/transcribeClient';
import {
  parseSpeakerTurns, stripSpeakerMarkers,
  detectSessionLang, groupSessions,
} from '@/lib/transcriptFormat';
import {
  ANALYSIS_FIELDS, LEGACY_ANALYSIS_FIELDS, analysisToText, hasValue,
} from '@/lib/analysisFormat';

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

// Silence detection. Whole-file mean RMS is the WRONG statistic — long therapy
// pauses dilute it below any threshold, so real speech reads as silent. Instead
// we look at the loudest ~1s window: if any second reaches speech-level energy,
// the recording is not silent. We only skip transcription when the windowed RMS
// AND the sample peak both indicate silence, so a genuinely quiet-but-real
// recording is never dropped — a false skip loses data, a false pass merely
// costs one API round-trip that returns empty.
const SPEECH_WINDOW_RMS  = 0.02;  // loudest ~1s window must reach this to be "speech"
const SILENCE_PEAK_FLOOR = 0.05;  // ...and no sample exceeds this → truly silent

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

// MediaRecorder defaults to ~128 kbps, which turned a 91-minute session into an
// 84.7 MB upload that never made it to AssemblyAI. Speech recognition does not
// need music-grade audio: Opus at 32 kbps is comfortably intelligible speech and
// makes the same session ~21 MB. This is the single biggest reason long
// recordings failed to upload.
const SPEECH_BITS_PER_SECOND = 32000;

// Lightweight VU-meter shown during recording. Passive AnalyserNode tap on the
// MediaRecorder stream — source.connect(analyser) only, NEVER connected to
// destination, so it cannot alter the recorded signal. Uses requestAnimationFrame
// (not setInterval, so it doesn't touch the recording timer) and lives in its own
// component so the ~60fps updates don't re-render the whole page.
// Persist the active Recall bot id so a page reload / navigation doesn't lose an
// in-progress recording: on load we re-adopt it and resume polling until the
// transcript is saved. (On localhost there's no webhook fallback, so this is the
// safety net.) Cleared once the session is saved, discarded, or errors out.
const ZOOM_BOT_KEY = 'miru_zoom_bot';

// Recall.ai auto-detects the meeting platform from the URL server-side; this is
// only a light client-side check to validate the link and show which platform we
// recognised. Any of these hosts is accepted — the URL goes to Recall unchanged.
const MEETING_PLATFORMS = [
  { host: 'zoom.us',            name: 'Zoom' },
  { host: 'meet.google.com',    name: 'Google Meet' },
  { host: 'teams.microsoft.com', name: 'Microsoft Teams' },
  { host: 'teams.live.com',     name: 'Microsoft Teams' },
  { host: 'webex.com',          name: 'Webex' },
];
function detectPlatform(url) {
  const u = (url || '').toLowerCase();
  return MEETING_PLATFORMS.find(p => u.includes(p.host)) || null;
}

function AudioLevelMeter({ stream, source, paused, A, MUTED, TEXT }) {
  const [bars, setBars] = useState(() => new Array(9).fill(0));
  const [silentTooLong, setSilentTooLong] = useState(false);
  const silentSinceRef = useRef(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused; // keep the rAF loop (deps: [stream]) reading the live value
  useEffect(() => {
    if (!stream) return;
    silentSinceRef.current = null;
    setSilentTooLong(false);
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64; // tiny — 32 bins
    src.connect(analyser); // passive tap — analyser is NOT connected onward
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const next = Array.from({ length: 9 }, (_, i) => data[i * 2] / 255);
      setBars(next);
      // Warn if the level has been near-zero continuously for > 10s. Skip while
      // paused — silence is expected then, not a fault.
      const active = next.some(b => b > 0.08);
      const isPaused = pausedRef.current;
      const now = performance.now();
      if (active || isPaused) silentSinceRef.current = null;
      else if (silentSinceRef.current == null) silentSinceRef.current = now;
      setSilentTooLong(!isPaused && !active && silentSinceRef.current != null && now - silentSinceRef.current > 10000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      try { src.disconnect(); } catch {}
      try { ctx.close(); } catch {}
    };
  }, [stream]);
  const active = bars.some(b => b > 0.08);
  const warning = source === 'tab'
    ? '⚠️ Звук не поступает — проверьте, что включён доступ к звуку вкладки'
    : '⚠️ Микрофон не слышит звук — проверьте, что выбран правильный микрофон';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 40 }}>
        {bars.map((b, i) => (
          <div key={i} style={{
            width: 5,
            height: Math.max(6, b * 44),
            background: A,
            opacity: paused ? 0.35 : 0.5 + b * 0.5,
            borderRadius: 999,
            transition: 'height 0.06s linear, opacity 0.12s linear',
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: paused ? MUTED : (active ? A : MUTED), transition: 'background 0.2s' }} />
        <span style={{ fontSize: 12.5, color: paused ? MUTED : (active ? TEXT : MUTED), fontWeight: 500 }}>{paused ? 'Paused' : (active ? 'Hearing your voice' : 'Listening…')}</span>
      </div>
      {silentTooLong && (
        <p style={{ fontSize: 12.5, color: '#DC2626', fontWeight: 500, margin: 0, textAlign: 'center', lineHeight: 1.5 }}>{warning}</p>
      )}
    </div>
  );
}

function parseAI(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return { overview: raw }; }
}

// ─── Main component ────────────────────────────────────────────────────────────
function SessionsPageInner() {
  const { supabase, user } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL: A, ACCENT_DEEP, isDark } = useTheme();
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

  // Manual transcript entry/editing — the only way back for a session whose
  // transcription failed, and the way to fix ASR mistakes in one that succeeded.
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [transcriptDraft,   setTranscriptDraft]   = useState('');
  const [savingTranscript,  setSavingTranscript]  = useState(false);
  const [transcriptError,   setTranscriptError]   = useState('');
  const [analysing,       setAnalysing]       = useState(false);
  const [analyseError,    setAnalyseError]    = useState('');

  // recording modal
  const [showModal,          setShowModal]          = useState(false);
  const [isCapturing,        setIsCapturing]        = useState(false);
  const [isPaused,           setIsPaused]           = useState(false);
  const [isTranscribing,     setIsTranscribing]     = useState(false);
  const [isReview,           setIsReview]           = useState(false);
  const [seconds,            setSeconds]            = useState(0);
  const [transcript,         setTranscript]         = useState('');
  const [recNotes,           setRecNotes]           = useState('');
  const [recTitle,           setRecTitle]           = useState(''); // name typed on the Dashboard
  const [saving,             setSaving]             = useState(false);
  const [saved,              setSaved]              = useState(false);
  const [showPreMood,        setShowPreMood]        = useState(false);
  const [preRecordMoodIdx,   setPreRecordMoodIdx]   = useState(null);
  const [captureSource,      setCaptureSource]      = useState('mic'); // 'mic' | 'tab'
  const [micDevices,         setMicDevices]         = useState([]);
  const [selectedMicId,      setSelectedMicId]      = useState('');

  // The recorded audio is held until the session is SAVED, not until it is
  // transcribed — a failed upload must never cost the user the recording.
  const pendingAudioRef = useRef(null); // { blob, mimeType }
  const [transcribeFailed, setTranscribeFailed] = useState(false); // → show Retry
  const [uploadProgress,   setUploadProgress]   = useState(0);
  const [recovered,        setRecovered]        = useState(null); // recording found in IndexedDB after a reload

  // Zoom / Recall.ai notetaker
  const [showZoom,           setShowZoom]           = useState(false);
  const [zoomUrl,            setZoomUrl]            = useState('');
  const [zoomConsent,        setZoomConsent]        = useState(false);
  const [zoomBotId,          setZoomBotId]          = useState(null);
  const [zoomStatus,         setZoomStatus]         = useState('idle'); // idle|joining|recording|processing|done|error
  const [zoomError,          setZoomError]          = useState('');
  const [zoomStopping,       setZoomStopping]       = useState(false); // "Stop & Save" pressed → waiting for transcript

  // Paste an existing transcript (Zoom export, notes, another app) — a session
  // with text but no audio.
  const [showPaste,   setShowPaste]   = useState(false);
  const [pasteTitle,  setPasteTitle]  = useState('');
  const [pasteText,   setPasteText]   = useState('');
  const [pasteSaving, setPasteSaving] = useState(false);
  const [pasteError,  setPasteError]  = useState('');

  // Import audio (upload a file → AssemblyAI → session)
  const importInputRef = useRef(null);
  const [showImport,     setShowImport]     = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importStage,    setImportStage]    = useState(''); // uploading|processing|done|error
  const [importProgress, setImportProgress] = useState(0);
  const [importError,    setImportError]    = useState('');
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
      openRecordModal(
        preMoodParam !== null ? Number(preMoodParam) : undefined,
        searchParams.get('name') || '',
      );
      router.replace('/sessions');
    }
  }, [searchParams]);

  // ── scroll chat to bottom ────────────────────────────────────────────────────
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── select session ────────────────────────────────────────────────────────────
  function selectSession(s) {
    // The panels render into the same centre column as the session detail, so
    // an open one would swallow the click: the row highlights in the list and
    // nothing else appears to happen. Close Paste — but only when it is empty,
    // so a half-written transcript is never discarded by a stray click. The
    // other three panels are left alone deliberately: each has work running
    // behind it (a recording, an upload, a meeting bot) that must not be
    // dismissed by selecting a session.
    if (showPaste && !pasteText.trim()) closePaste();
    setSelectedSession(s);
    setActiveTab('summary');
    setSessionNotes(s.notes || '');
    // Never carry another session's draft across — seed from the one just opened.
    setEditingTranscript(false);
    setTranscriptDraft(s.transcript || '');
    setTranscriptError('');
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

  // All four capture panels render into the same centre column, so two open at
  // once would stack on top of each other. One switch keeps them exclusive
  // instead of every opener remembering to close the other three.
  function closeOtherPanels(keep) {
    if (keep !== 'import') setShowImport(false);
    if (keep !== 'zoom')   setShowZoom(false);
    if (keep !== 'record') setShowModal(false);
    if (keep !== 'paste')  setShowPaste(false);
  }

  function openPaste() {
    closeOtherPanels('paste');
    setSelectedSession(null);
    setShowPaste(true);
    setPasteTitle(''); setPasteText(''); setPasteError('');
  }

  function closePaste() {
    setShowPaste(false);
    setPasteTitle(''); setPasteText(''); setPasteError('');
  }

  // Create a session straight from pasted text. Goes through sessionsApi.save
  // like every other session, so the row is indistinguishable downstream —
  // Analyse, search and the speaker-turn renderer all work on it unchanged.
  // Not routed through saveSession(): that one is the recording flow's ending
  // (audio cleanup, mood pair, elapsed timer, delayed modal close), none of
  // which applies to pasted text.
  async function createFromPaste() {
    const text = pasteText.trim();
    if (!text || pasteSaving) return;
    if (!user) { setPasteError('Not signed in.'); return; }
    setPasteSaving(true); setPasteError('');
    try {
      const saved = await sessionsApi.save(supabase, {
        // Empty title → sessionTitle() derives one from created_at at display
        // time, same as an untitled recording.
        title: pasteTitle.trim() || null,
        transcript: text,
        duration: null, notes: null,
        mood_before: null, mood_after: null,
      });
      setSessions(list => [saved, ...list]);
      closePaste();
      // Opens on Summary, where Analyse is live because the transcript exists.
      selectSession(saved);
    } catch (err) {
      console.error('[Sessions] paste create:', err?.message, err?.code);
      setPasteError('Не удалось создать сессию: ' + (err?.message || 'неизвестная ошибка'));
    } finally { setPasteSaving(false); }
  }

  // In single-column mode (<800px) the container needs to know which pane to
  // show. The centre is "occupied" not only by an open session but by the
  // recording / import / meeting panels, which also live there — without those
  // the narrow layout would hide the recorder the moment it opened.
  const detailOpen = !!(selectedSession || showModal || showImport || showZoom || showPaste);

  // Back out of the centre pane. Deliberately refuses while a recording or an
  // upload is in flight: closeModal() stops the recorder, and losing a session
  // to a mis-tap on "back" is exactly the failure this app has been fixing.
  const canGoBack = !isCapturing && !isTranscribing;
  function backToList() {
    if (!canGoBack) return;
    if (showPaste)       { closePaste();  return; }
    if (showImport)      { closeImport(); return; }
    if (showZoom)        { setShowZoom(false); return; }
    if (showModal)       { closeModal(); return; }
    setSelectedSession(null);
  }

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
  // Populate the microphone dropdown. Device labels are only exposed after mic
  // permission has been granted at least once (first recording), so they may show
  // as "Микрофон N" until then.
  async function refreshMicDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicDevices(devices.filter(d => d.kind === 'audioinput'));
    } catch { /* ignore — dropdown just stays empty */ }
  }

  function openRecordModal(preMoodIntensity, title = '') {
    setShowModal(true);
    closeOtherPanels('record');
    setSpeechError('');
    setTranscript('');
    setRecNotes('');
    setRecTitle(title);
    chunksRef.current = [];
    refreshMicDevices();
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
    setShowModal(false); setIsCapturing(false); setIsPaused(false); setIsTranscribing(false); setIsReview(false);
    setSeconds(0); setTranscript(''); setRecNotes(''); setRecTitle(''); setSaved(false);
    setShowPreMood(false); setPreRecordMoodIdx(null);
    setPostRecordMoodIdx(null); setPostMoodSaved(false);
    setSpeechError(''); setSaveError('');
    setTranscribeFailed(false); setUploadProgress(0);
    chunksRef.current = [];
    // Closing with a failed transcription and nothing saved is NOT a discard —
    // keep the audio so the recovery banner can offer it again. Anything else
    // (saved, or transcribed fine) has served its purpose and can go.
    if (!(transcribeFailed && !saved)) {
      pendingAudioRef.current = null;
      forgetPendingJob();
      clearPendingRecording();
    }
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
      if (captureSource === 'tab') {
        // Capture tab/system audio — the correct way to record an online session
        // (Zoom etc.) where the other person is heard through headphones/speakers
        // and never reaches the mic. Chrome requires video:true to offer the
        // "Share tab audio" checkbox in its picker.
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const audioTracks = display.getAudioTracks();
        if (audioTracks.length === 0) {
          display.getTracks().forEach(t => t.stop());
          setSpeechError('Звук вкладки не захвачен — при выборе источника поставьте галочку «Поделиться звуком вкладки».');
          startGuardRef.current = false; return;
        }
        display.getVideoTracks().forEach(t => t.stop()); // record audio only, drop video
        stream = new MediaStream(audioTracks);
      } else {
        // Microphone. echoCancellation/noiseSuppression OFF (Chrome's AEC distorted
        // the built-in mic to noise; NS gated quiet speech); autoGainControl ON to
        // lift the quiet far-field signal. deviceId pins the chosen mic when set.
        const audio = { noiseSuppression: false, autoGainControl: true, echoCancellation: false };
        if (selectedMicId) audio.deviceId = { exact: selectedMicId };
        stream = await navigator.mediaDevices.getUserMedia({ audio });
      }
    }
    catch {
      setSpeechError(captureSource === 'tab' ? 'Доступ к звуку вкладки отклонён.' : 'Microphone access denied.');
      startGuardRef.current = false; return;
    }
    refreshMicDevices(); // permission is now granted → device labels are available

    const mimeType = getSupportedMimeType();
    const mr = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: SPEECH_BITS_PER_SECOND,
    });
    mediaRef.current = mr;
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onerror = (e) => { setSpeechError('Recording error: ' + (e?.error?.message || 'unknown')); clearInterval(timerRef.current); setIsCapturing(false); };
    mr.start(1000);
    setIsCapturing(true); setIsPaused(false); setSeconds(0);
    clearInterval(timerRef.current); // defensive: never leave a stale interval running
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    startGuardRef.current = false; // setup complete — mediaRef.current now guards re-entry
  }

  // Pause/resume the live recording. MediaRecorder.pause()/resume() keeps a single
  // continuous file — chunks before and after the pause concatenate into one blob,
  // so AssemblyAI still gets one uninterrupted stream. The timer freezes (doesn't
  // reset) so elapsed time reflects only recorded audio.
  function pauseRecording() {
    if (!mediaRef.current || mediaRef.current.state !== 'recording') return;
    mediaRef.current.pause();
    clearInterval(timerRef.current);
    setIsPaused(true);
  }

  function resumeRecording() {
    if (!mediaRef.current || mediaRef.current.state !== 'paused') return;
    mediaRef.current.resume();
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    setIsPaused(false);
  }

  async function stopRecording() {
    clearInterval(timerRef.current);
    setIsCapturing(false); setIsPaused(false);
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

    // Hold the audio BEFORE attempting transcription, in memory and on disk. The
    // 91-minute session was lost because the blob lived only in a ref, so the
    // upload error took the recording with it. It is cleared once the session is
    // saved (or explicitly discarded) — not merely once transcription succeeds.
    pendingAudioRef.current = { blob: audioBlob, mimeType };
    await savePendingRecording({ blob: audioBlob, mimeType, seconds });

    await transcribePending();
  }

  // Upload the held recording and transcribe it. Split out of stopRecording so
  // Retry re-runs exactly this path — no re-recording, no second code path.
  //
  // Two phases now: the upload creates a job and returns immediately, then we
  // poll for the result. The route can no longer hold the request open for the
  // whole transcription — no serverless platform allows that for a 90-minute
  // recording — and a dropped poll no longer kills the job.
  async function transcribePending() {
    const pending = pendingAudioRef.current;
    if (!pending) return;
    const { blob, mimeType } = pending;
    console.log('[transcribe] blob size:', blob.size, 'bytes, mimeType:', mimeType,
      `(${(blob.size / 1024 / 1024).toFixed(1)} MB)`);

    setSpeechError(''); setTranscribeFailed(false); setUploadProgress(0);
    setIsTranscribing(true);
    try {
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      const { job_id } = await uploadForTranscription('/api/transcribe', blob, {
        filename: `recording.${ext}`,
        contentType: mimeType,
        onProgress: setUploadProgress,
      });
      setUploadProgress(100); // upload done — the wait is now server-side
      // The upload is the expensive half. Remember the job so a reload rejoins
      // this same transcription instead of re-uploading the recording.
      rememberPendingJob(job_id);
      const data = await pollTranscript(job_id);
      // The server already strips hallucination boilerplate (per-utterance when
      // the audio is diarized), so use its text verbatim — re-stripping here
      // would collapse the "Speaker A:" block separators into one paragraph.
      const finalText = data.text || '';
      forgetPendingJob(); // settled — nothing left to rejoin
      setTranscript(finalText);
      if (!finalText) setSpeechError('No speech detected in the recording.');
    } catch (err) {
      console.error('[transcribe]', err);
      // The job is done for either way; the audio stays in IndexedDB so the
      // recovery banner can still offer a fresh attempt.
      forgetPendingJob();
      setTranscribeFailed(true);
      setSpeechError('Не удалось расшифровать: ' + err.message);
      setTranscript('');
    } finally {
      setIsTranscribing(false); setIsReview(true); setUploadProgress(0);
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

  // ── Zoom / Recall.ai notetaker ───────────────────────────────────────────────
  async function startZoom() {
    if (!zoomUrl.trim() || !zoomConsent) return;
    setZoomError('');
    // Log consent (GDPR / therapy): both parties agreed before the bot joins.
    console.log('[Zoom] recording consent given', new Date().toISOString(), 'meeting:', zoomUrl.trim());
    try {
      const res = await fetch('/api/recall/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_url: zoomUrl.trim(), user_id: user?.id }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setZoomBotId(data.bot_id);
      setZoomStatus('joining');
      try { localStorage.setItem(ZOOM_BOT_KEY, data.bot_id); } catch {}
    } catch (e) { setZoomError(e.message); setZoomStatus('error'); }
  }

  function closeZoom() {
    setShowZoom(false); setZoomUrl(''); setZoomConsent(false);
    setZoomBotId(null); setZoomStatus('idle'); setZoomError(''); setZoomStopping(false);
    try { localStorage.removeItem(ZOOM_BOT_KEY); } catch {}
  }

  // "Stop & Save": tell the bot to leave, then let the poll below carry it through
  // processing → done and save the session. We keep the window in a "processing"
  // state (no close button) so the local poll survives until the transcript lands.
  async function stopAndSaveZoom() {
    if (!zoomBotId) return;
    setZoomError('');
    setZoomStopping(true);
    try {
      const res = await fetch('/api/recall/leave', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_id: zoomBotId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // Success (200) OR already_done (bot finished on its own before leave) both
      // mean "bot is out of the meeting" — either way the poll effect will observe
      // processing → done and save the transcript automatically.
    } catch (e) {
      setZoomError('Не удалось остановить бота: ' + e.message);
      setZoomStopping(false);
    }
  }

  // "Cancel": confirm, tell the bot to leave, and do NOT save. Closing first nulls
  // zoomBotId so the poll effect tears down before it can save this recording.
  async function discardZoom() {
    if (!window.confirm('Discard recording? The session will not be saved.')) return;
    const botId = zoomBotId;
    closeZoom();
    if (botId) {
      try {
        await fetch('/api/recall/leave', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bot_id: botId }),
        });
      } catch { /* best-effort — the bot leaves on its own eventually */ }
    }
  }

  // Re-attempt the save after a save failure (transcript is already on Recall).
  async function retrySaveZoom() {
    if (!zoomBotId) { closeZoom(); return; }
    setZoomError(''); setZoomStatus('saving');
    try {
      const res = await fetch(`/api/recall/status?bot_id=${encodeURIComponent(zoomBotId)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const saved = await sessionsApi.saveFromRecall(supabase, { transcript: data.transcript, recall_bot_id: zoomBotId });
      setSessions(list => list.some(s => s.id === saved.id) ? list : [saved, ...list]);
      setSelectedSession(saved);
      try { localStorage.removeItem(ZOOM_BOT_KEY); } catch {}
      setZoomStatus('done');
    } catch (e) { setZoomStatus('error'); setZoomError('Не удалось сохранить сессию: ' + e.message); }
  }

  // ── Import audio (upload a recording → transcribe → session) ──────────────────
  function pickImportFile() { importInputRef.current?.click(); }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    closeOtherPanels('import');
    setSelectedSession(null);
    setShowImport(true); setImportFileName(file.name); setImportError('');
    setImportProgress(0); setImportStage('uploading');

    // Check type and size HERE, not just on the server: a 3 GB mp4 would spend
    // minutes uploading before the server could tell us it is unusable.
    const ext = extOf(file.name);
    if (!ALLOWED_EXT.includes(ext)) {
      setImportError(unsupportedTypeMessage(ext)); setImportStage('error'); return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setImportError(tooLargeMessage(file.size, ext)); setImportStage('error'); return;
    }

    try {
      // Send the file as a RAW binary body (not multipart/form-data) — the server
      // reads it via req.arrayBuffer(). This avoids the flaky multipart parser
      // ("Failed to parse body as FormData"). The filename travels in a header so
      // the server can validate the extension. The upload creates a transcription
      // job and returns its id; the "processing" stage is the polling that
      // follows, sharing /api/transcribe/status with the live recording flow.
      const { job_id } = await uploadForTranscription('/api/transcribe-file', file, {
        filename: file.name,
        contentType: file.type,
        onProgress: setImportProgress,
      });
      setImportProgress(100);
      setImportStage('processing');
      const data = await pollTranscript(job_id);

      const saved = await sessionsApi.save(supabase, { transcript: data.text || '', title: null });
      setSessions(list => [saved, ...list]);
      setImportStage('done');
      setSelectedSession(saved);
    } catch (err) {
      setImportError(err.message); setImportStage('error');
    }
  }

  function closeImport() {
    setShowImport(false); setImportStage(''); setImportFileName(''); setImportError(''); setImportProgress(0);
  }

  // Poll the bot until done/error. On done, save the session (upsert-dedup vs the
  // webhook path). This is what makes it work locally where the webhook can't reach.
  useEffect(() => {
    if (!zoomBotId) return;
    let cancelled = false, iv;
    const poll = async () => {
      try {
        const res = await fetch(`/api/recall/status?bot_id=${encodeURIComponent(zoomBotId)}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.error) { clearInterval(iv); setZoomStatus('error'); setZoomError(data.error); try { localStorage.removeItem(ZOOM_BOT_KEY); } catch {} return; }
        if (data.status === 'error') { clearInterval(iv); setZoomStatus('error'); setZoomError('Recording failed on Recall.'); try { localStorage.removeItem(ZOOM_BOT_KEY); } catch {} return; }
        if (data.status === 'done') {
          clearInterval(iv);
          setZoomStatus('saving'); // transcript ready — now actually persist it; success is NOT shown yet
          try {
            const saved = await sessionsApi.saveFromRecall(supabase, { transcript: data.transcript, recall_bot_id: zoomBotId });
            if (cancelled) return;
            setSessions(list => list.some(s => s.id === saved.id) ? list : [saved, ...list]);
            setSelectedSession(saved);
            try { localStorage.removeItem(ZOOM_BOT_KEY); } catch {}
            setZoomStatus('done'); // ONLY now — after Supabase confirmed the row exists
          } catch (e) {
            if (!cancelled) { setZoomStatus('error'); setZoomError('Не удалось сохранить сессию: ' + e.message); }
            // keep zoomBotId + localStorage so the user can retry the save
          }
          return;
        }
        setZoomStatus(data.status); // non-terminal: joining / recording / processing
      } catch (e) { if (!cancelled) { clearInterval(iv); setZoomStatus('error'); setZoomError(e.message); } }
    };
    poll();
    iv = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [zoomBotId, supabase]);

  // Resume on load: if a recording was in progress when the page was reloaded /
  // navigated away (bot id persisted in localStorage), or a recovery link
  // ?recall_bot=<id> is present, re-adopt the bot so the poll above resumes and
  // saves the transcript once it's ready. Runs once on mount.
  useEffect(() => {
    let botId = '';
    try {
      const url = new URL(window.location.href);
      const fromLink = url.searchParams.get('recall_bot');
      botId = fromLink || localStorage.getItem(ZOOM_BOT_KEY) || '';
      if (fromLink) {
        localStorage.setItem(ZOOM_BOT_KEY, fromLink);
        url.searchParams.delete('recall_bot');
        window.history.replaceState({}, '', url.pathname + url.search);
      }
    } catch {}
    if (botId) {
      setShowImport(false); setShowModal(false); setSelectedSession(null);
      setShowZoom(true);
      setZoomStatus('processing'); // neutral until the first poll reports the real status
      setZoomBotId(botId);         // arms the poll effect above
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A transcription that was still running when the page was reloaded: the job
  // lives on AssemblyAI regardless of this tab, so rejoin it rather than making
  // the user upload a 90-minute recording a second time. On failure we fall
  // through to the recovery banner below — the audio is still in IndexedDB.
  useEffect(() => {
    const jobId = loadPendingJob();
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      setShowImport(false); setShowZoom(false); setSelectedSession(null);
      setShowModal(true); setIsTranscribing(true); setIsReview(false);
      setSaved(false); setSpeechError(''); setTranscript('');
      try {
        const data = await pollTranscript(jobId, { isCancelled: () => cancelled });
        if (cancelled) return;
        forgetPendingJob();
        const finalText = data.text || '';
        setTranscript(finalText);
        if (!finalText) setSpeechError('No speech detected in the recording.');
        // Re-adopt the held audio so Retry and Save behave as if we never left.
        const rec = await loadPendingRecording();
        if (rec && !cancelled) {
          pendingAudioRef.current = { blob: rec.blob, mimeType: rec.mimeType || 'audio/webm' };
          setSeconds(rec.seconds || 0);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[transcribe] resume:', err?.message);
        forgetPendingJob();
        setTranscribeFailed(true);
        setSpeechError('Не удалось возобновить расшифровку: ' + err.message);
      } finally {
        if (!cancelled) { setIsTranscribing(false); setIsReview(true); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A recording left behind by a failed transcription — or by a reload/crash mid
  // flow — is offered back instead of silently rotting in IndexedDB. Skipped
  // while a resumed job is still being polled, so the two can't both claim it.
  useEffect(() => {
    if (loadPendingJob()) return;
    loadPendingRecording().then(rec => { if (rec) setRecovered(rec); });
  }, []);

  function resumeRecovered() {
    if (!recovered) return;
    pendingAudioRef.current = { blob: recovered.blob, mimeType: recovered.mimeType || 'audio/webm' };
    setSeconds(recovered.seconds || 0);
    setRecovered(null);
    setShowModal(true); setIsReview(true); setSaved(false); setTranscript(''); setRecNotes('');
    transcribePending();
  }

  async function discardRecovered() {
    setRecovered(null);
    pendingAudioRef.current = null;
    forgetPendingJob();
    await clearPendingRecording();
  }

  async function saveSession() {
    if (!user) { setSaveError('Not signed in.'); return; }
    setSaving(true); setSaveError('');
    try {
      console.log('[Sessions] saving, transcript length:', transcript?.length);
      const result = await sessionsApi.save(supabase, {
        // The Dashboard's session-name field used to be discarded entirely — it
        // was never passed through to this page. Fall back to the old
        // notes-derived title, then to null (sessionTitle derives one from
        // created_at at display time).
        title:    recTitle.trim() || recNotes.slice(0, 60) || null,
        transcript, notes: recNotes, duration: seconds,
        mood_before: preRecordMoodIdx  !== null ? SESSION_MOODS[preRecordMoodIdx].intensity  : null,
        mood_after:  postRecordMoodIdx !== null ? SESSION_MOODS[postRecordMoodIdx].intensity : null,
      });
      setSessions(s => [result, ...s]);
      setSaved(true);
      // The transcript is safely in the database — the audio copy can go now.
      pendingAudioRef.current = null;
      setRecovered(null);
      forgetPendingJob();
      clearPendingRecording();
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

      // The first action item becomes a homework task. This read `analysis.action`
      // — a field the model has never been asked to return — so the hook was
      // dead: analysing a session silently created no homework at all.
      const firstAction = [data.analysis?.action_items, data.analysis?.action]
        .flat()
        .find(a => typeof a === 'string' && a.trim());
      if (firstAction) {
        try {
          const existing = await homeworkApi.forSession(supabase, selectedSession.id);
          if (!existing) {
            await homeworkApi.save(supabase, {
              title:       firstAction.trim().slice(0, 120),
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

  // ── transcript: manual entry / editing ───────────────────────────────────────
  // Writes straight to sessions.transcript, so a hand-typed transcript is
  // indistinguishable downstream from a transcribed one — Analyse, search and
  // the speaker-turn renderer all just work on it.
  async function saveTranscript() {
    if (!selectedSession || !user) return;
    setSavingTranscript(true); setTranscriptError('');
    try {
      const text = transcriptDraft.trim();
      const value = text || null; // empty → NULL, matching how sessions are saved
      await sessionsApi.update(supabase, selectedSession.id, { transcript: value });
      setSelectedSession(s => ({ ...s, transcript: value }));
      setSessions(list => list.map(s => s.id === selectedSession.id ? { ...s, transcript: value } : s));
      setEditingTranscript(false);
    } catch (e) {
      console.error('[Sessions] transcript save:', e?.message);
      setTranscriptError('Не удалось сохранить: ' + (e?.message || 'unknown'));
    } finally { setSavingTranscript(false); }
  }

  function startEditTranscript() {
    setTranscriptDraft(selectedSession?.transcript || '');
    setTranscriptError('');
    setEditingTranscript(true);
  }

  function cancelEditTranscript() {
    setTranscriptDraft(selectedSession?.transcript || '');
    setTranscriptError('');
    setEditingTranscript(false);
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
    // Was `[ai.overview, ai.key_theme, ai.breakthrough, ai.action].join()`: the
    // first is an array (so it copied as a comma run) and the last two are
    // fields the current analysis does not have, so they were always dropped.
    const text = (ai && analysisToText(ai)) || selectedSession.transcript || '';
    navigator.clipboard.writeText(text).catch(() => {});
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className={`sessions-layout${detailOpen ? ' show-detail' : ''}`}>

        {/* ── LEFT COLUMN ─────────────────────────────────────────────────────── */}
        <div className="sessions-list" style={{ borderRight: `1px solid ${BORDER}`, background: SURFACE }}>
          {/* Search */}
          <div style={{ padding: '16px 14px 10px' }}>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search conversations…"
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 9, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
              onFocus={e => e.target.style.borderColor = A}
              onBlur={e  => e.target.style.borderColor = BORDER}
            />
          </div>

          {/* A recording survived a failed transcription or a reload — offer it back
              rather than leaving the user to assume the session is gone. */}
          {recovered && !showModal && (
            <div style={{ margin: '0 14px 12px', background: A + '14', border: `1px solid ${A}55`, borderRadius: 14, padding: '12px 13px' }}>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: TEXT, margin: '0 0 4px' }}>Найдена нерасшифрованная запись</p>
              <p style={{ fontSize: 11.5, color: MUTED, margin: '0 0 10px', lineHeight: 1.5 }}>
                {fmt(recovered.seconds || 0)} · {(recovered.blob.size / 1024 / 1024).toFixed(1)} МБ — расшифровка не завершилась.
              </p>
              <div style={{ display: 'flex', gap: 7 }}>
                <button onClick={resumeRecovered}
                  style={{ flex: 2, padding: '7px 0', borderRadius: 8, border: 'none', background: A, color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                  ↻ Расшифровать
                </button>
                <button onClick={discardRecovered}
                  style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 12, cursor: 'pointer' }}>
                  Удалить
                </button>
              </div>
            </div>
          )}

          {/* Import + Record */}
          <input ref={importInputRef} type="file" accept=".mp3,.m4a,.wav,.mp4,audio/*,video/mp4"
            onChange={handleImportFile} style={{ display: 'none' }} />
          <div style={{ padding: '0 14px 12px', display: 'flex', gap: 8 }}>
            <button onClick={pickImportFile} title="Upload an audio file (mp3, m4a, wav, mp4)"
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
              ↑ Upload audio
            </button>
            <button onClick={openRecordModal}
              style={{ flex: 1, padding: '8px 0', borderRadius: 999, border: 'none', background: ACCENT_DEEP, color: isDark ? BG : '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="3.5" fill="white" opacity="0.35"/><circle cx="5" cy="5" r="2" fill="white"/></svg>
              Record
            </button>
          </div>

          {/* Record Zoom meeting (Recall.ai notetaker) */}
          <div style={{ padding: '0 14px 12px' }}>
            <button onClick={() => { closeOtherPanels('zoom'); setShowZoom(true); setSelectedSession(null); }}
              style={{ width: '100%', padding: '8px 0', borderRadius: 8, border: `1px solid ${BORDER}`, background: 'transparent', color: A, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              🎥 Record online session
            </button>
          </div>

          {/* Paste an existing transcript — no audio involved */}
          <div style={{ padding: '0 14px 12px' }}>
            <button onClick={openPaste}
              style={{ width: '100%', padding: '8px 0', borderRadius: 8, border: `1px solid ${BORDER}`, background: showPaste ? A + '12' : 'transparent', color: showPaste ? A : MUTED, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              ✎ Paste transcript
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
        <div className="sessions-main" style={{ background: BG }}>
          {/* Only rendered by CSS below 800px, where the list is hidden. */}
          {canGoBack && (
            <button className="sessions-back" onClick={backToList}
              style={{ alignItems: 'center', gap: 8, padding: '11px 16px', border: 'none',
                       borderBottom: `1px solid ${BORDER}`, background: SURFACE, color: A,
                       fontSize: 13.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                       flexShrink: 0, width: '100%', textAlign: 'left' }}>
              ← Все сессии
            </button>
          )}
          {showPaste ? (
            /* ── PASTE TRANSCRIPT (existing text → session, no audio) ─────────────── */
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: 28 }}>
              <div style={{ width: '100%', maxWidth: 720, height: 'fit-content', background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 32 }}>
                <p style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 300, color: TEXT, margin: '0 0 6px' }}>Paste transcript</p>
                <p style={{ fontSize: 13, color: MUTED, margin: '0 0 24px', lineHeight: 1.5 }}>
                  Уже есть текст — из записи Zoom, другого приложения или заметок? Вставьте его,
                  и сессия будет вести себя как любая другая: поиск, AI-анализ, чат.
                </p>

                <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Название</p>
                <input value={pasteTitle} onChange={e => setPasteTitle(e.target.value)}
                  placeholder="Необязательно — по умолчанию дата"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 14, outline: 'none', fontFamily: 'inherit', marginBottom: 18 }} />

                <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Транскрипт</p>
                <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
                  placeholder="Paste your transcript here…"
                  style={{ width: '100%', boxSizing: 'border-box', minHeight: 300, padding: '14px 16px', borderRadius: 12, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 14, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.8 }} />

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: MUTED }}>
                    {pasteText.trim() ? `${pasteText.trim().length.toLocaleString('ru-RU')} символов` : ''}
                  </span>
                </div>

                {pasteError && <p style={{ fontSize: 13, color: '#DC2626', margin: '12px 0 0', lineHeight: 1.5 }}>⚠ {pasteError}</p>}

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                  <button onClick={closePaste} disabled={pasteSaving}
                    style={{ padding: '10px 20px', borderRadius: 11, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 14, cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button onClick={createFromPaste} disabled={!pasteText.trim() || pasteSaving}
                    style={{ padding: '10px 26px', borderRadius: 999, border: 'none', background: pasteText.trim() ? ACCENT_DEEP : BORDER, color: pasteText.trim() && isDark ? BG : '#fff', fontSize: 14, fontWeight: 500, cursor: pasteText.trim() && !pasteSaving ? 'pointer' : 'default' }}>
                    {pasteSaving ? 'Creating…' : 'Create session'}
                  </button>
                </div>
              </div>
            </div>
          ) : showImport ? (
            /* ── IMPORT AUDIO (upload → transcribe → session) ─────────────────────── */
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: 28 }}>
              <div style={{ width: '100%', maxWidth: 560, height: 'fit-content', background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 32 }}>
                <p style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 300, color: TEXT, margin: '0 0 6px' }}>Import audio</p>
                <p style={{ fontSize: 13, color: MUTED, margin: '0 0 4px', wordBreak: 'break-all' }}>{importFileName}</p>
                <p style={{ fontSize: 12, color: MUTED, margin: '0 0 24px' }}>mp3, m4a, wav, mp4 — transcribed via AssemblyAI (EU).</p>

                {(importStage === 'uploading' || importStage === 'processing') && (
                  <div style={{ textAlign: 'center', padding: '4px 0' }}>
                    {importStage === 'uploading' ? (
                      <>
                        <p style={{ fontSize: 14, color: TEXT, margin: '0 0 12px' }}>Uploading… {importProgress}%</p>
                        <div style={{ width: '100%', height: 8, borderRadius: 4, background: BORDER, overflow: 'hidden' }}>
                          <div style={{ width: `${importProgress}%`, height: '100%', background: A, transition: 'width 0.2s' }} />
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ width: 44, height: 44, border: `3px solid ${BORDER}`, borderTop: `3px solid ${A}`, borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
                        <p style={{ fontSize: 15, color: TEXT, margin: '0 0 6px' }}>Transcribing…</p>
                        <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>Это может занять несколько минут для длинной записи.</p>
                      </>
                    )}
                    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                  </div>
                )}

                {importStage === 'done' && (
                  <div style={{ textAlign: 'center', padding: '8px 0' }}>
                    <p style={{ fontSize: 30, margin: '0 0 8px', color: '#15803D' }}>✓</p>
                    <p style={{ fontSize: 15, color: TEXT, margin: '0 0 6px' }}>Готово — сессия создана.</p>
                    <p style={{ fontSize: 12, color: MUTED, margin: '0 0 20px' }}>Транскрипт сохранён в список сессий.</p>
                    <button onClick={closeImport} style={{ padding: '10px 22px', borderRadius: 11, border: 'none', background: A, color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Done</button>
                  </div>
                )}

                {importStage === 'error' && (
                  <div style={{ textAlign: 'center', padding: '8px 0' }}>
                    {/* Size errors carry a copy-pasteable ffmpeg command on a second
                        line — keep the newline and give the command a mono block. */}
                    {(() => {
                      const [head, ...rest] = (importError || 'Не удалось обработать файл.').split('\n');
                      const cmd = rest.join('\n').trim();
                      return (
                        <div style={{ margin: '0 0 16px', textAlign: cmd ? 'left' : 'center' }}>
                          <p style={{ fontSize: 14, color: '#DC2626', margin: 0, lineHeight: 1.6 }}>⚠️ {head}</p>
                          {cmd && (
                            <code style={{ display: 'block', marginTop: 10, padding: '10px 12px', borderRadius: 9, background: 'rgba(127,127,127,0.12)', color: MUTED, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'all' }}>{cmd}</code>
                          )}
                        </div>
                      );
                    })()}
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                      <button onClick={closeImport} style={{ padding: '9px 18px', borderRadius: 11, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 13, cursor: 'pointer' }}>Close</button>
                      <button onClick={() => { closeImport(); pickImportFile(); }} style={{ padding: '9px 18px', borderRadius: 11, border: 'none', background: A, color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Choose another file</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : showZoom ? (
            /* ── RECALL / ZOOM NOTETAKER ─────────────────────────────────────────── */
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: 28 }}>
              <div style={{ width: '100%', maxWidth: 560, height: 'fit-content', background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 32 }}>
                <p style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 300, color: TEXT, margin: '0 0 6px' }}>Record online session</p>
                <p style={{ fontSize: 13, color: MUTED, margin: '0 0 24px', lineHeight: 1.5 }}>A notetaker bot joins your call and transcribes it. Works with Zoom, Google Meet, Microsoft Teams, and Webex.</p>

                {zoomStatus === 'idle' && (() => {
                  const platform = detectPlatform(zoomUrl);
                  const hasUrl = zoomUrl.trim().length > 0;
                  const invalid = hasUrl && !platform;
                  const canSend = !!platform && zoomConsent;
                  return (
                  <>
                    <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Meeting link</p>
                    <input value={zoomUrl} onChange={e => setZoomUrl(e.target.value)}
                      placeholder="Paste meeting link (Zoom, Google Meet, Teams...)"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1px solid ${invalid ? '#DC2626' : BORDER}`, background: BG, color: TEXT, fontSize: 13, outline: 'none', fontFamily: 'inherit', marginBottom: 6 }} />
                    {platform
                      ? <p style={{ fontSize: 12, color: '#15803D', fontWeight: 500, margin: '0 0 16px' }}>✓ {platform.name} detected</p>
                      : invalid
                        ? <p style={{ fontSize: 12, color: '#DC2626', margin: '0 0 16px' }}>Please paste a valid meeting link</p>
                        : <p style={{ fontSize: 12, color: MUTED, margin: '0 0 16px' }}>Zoom, Google Meet, Microsoft Teams, or Webex</p>}
                    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 22 }}>
                      <input type="checkbox" checked={zoomConsent} onChange={e => setZoomConsent(e.target.checked)} style={{ marginTop: 3 }} />
                      <span style={{ fontSize: 13, color: TEXT, lineHeight: 1.5 }}>Both parties consent to recording this session.</span>
                    </label>
                    {zoomError && <p style={{ fontSize: 12, color: '#DC2626', margin: '0 0 12px' }}>{zoomError}</p>}
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button onClick={closeZoom} style={{ flex: 1, padding: 11, borderRadius: 12, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={startZoom} disabled={!canSend}
                        style={{ flex: 2, padding: 11, borderRadius: 12, border: 'none', background: canSend ? A : BORDER, color: '#fff', fontSize: 14, fontWeight: 500, cursor: canSend ? 'pointer' : 'default' }}>Send Notetaker</button>
                    </div>
                  </>
                  );
                })()}

                {['joining', 'recording', 'processing', 'saving'].includes(zoomStatus) && (
                  <div style={{ textAlign: 'center', padding: '12px 0' }}>
                    <div style={{ width: 44, height: 44, border: `3px solid ${BORDER}`, borderTop: `3px solid ${A}`, borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
                    <p style={{ fontSize: 15, color: TEXT, margin: '0 0 6px' }}>
                      {zoomStatus === 'saving'
                        ? 'Saving session…'
                        : zoomStopping
                          ? 'Processing transcript…'
                          : zoomStatus === 'joining' ? 'Бот заходит в встречу…' : zoomStatus === 'recording' ? '🔴 Идёт запись сессии…' : 'Обработка транскрипта…'}
                    </p>
                    <p style={{ fontSize: 12, color: MUTED, margin: 0, lineHeight: 1.5 }}>
                      {zoomStatus === 'saving'
                        ? 'Сохраняем транскрипт в базу…'
                        : zoomStopping
                          ? 'Транскрипт готовится — это займёт 3–5 минут. Не закрывайте окно, сессия сохранится автоматически.'
                          : 'Запись идёт. Сессия сохранится автоматически, даже если закрыть окно.'}
                    </p>
                    {zoomError && <p style={{ fontSize: 12, color: '#DC2626', margin: '10px 0 0' }}>{zoomError}</p>}
                    {!zoomStopping && zoomStatus !== 'saving' && (
                      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
                        <button onClick={discardZoom} style={{ padding: '9px 18px', borderRadius: 11, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                        <button onClick={stopAndSaveZoom} style={{ padding: '9px 20px', borderRadius: 11, border: 'none', background: A, color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Stop &amp; Save</button>
                      </div>
                    )}
                    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                  </div>
                )}

                {zoomStatus === 'done' && (
                  <div style={{ textAlign: 'center', padding: '12px 0' }}>
                    <p style={{ fontSize: 30, margin: '0 0 8px', color: '#15803D' }}>✓</p>
                    <p style={{ fontSize: 15, color: TEXT, margin: '0 0 6px' }}>Готово — сессия сохранена.</p>
                    <p style={{ fontSize: 12, color: MUTED, margin: '0 0 20px' }}>Транскрипт появился в списке сессий.</p>
                    <button onClick={closeZoom} style={{ padding: '10px 22px', borderRadius: 11, border: 'none', background: A, color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Done</button>
                  </div>
                )}

                {zoomStatus === 'error' && (
                  <div style={{ textAlign: 'center', padding: '12px 0' }}>
                    <p style={{ fontSize: 14, color: '#DC2626', margin: '0 0 16px', lineHeight: 1.6 }}>⚠️ {zoomError || 'Что-то пошло не так.'}</p>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                      <button onClick={closeZoom} style={{ padding: '9px 18px', borderRadius: 11, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 13, cursor: 'pointer' }}>Close</button>
                      {zoomBotId
                        ? <button onClick={retrySaveZoom} style={{ padding: '9px 18px', borderRadius: 11, border: 'none', background: A, color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Retry save</button>
                        : <button onClick={() => { setZoomStatus('idle'); setZoomError(''); }} style={{ padding: '9px 18px', borderRadius: 11, border: 'none', background: A, color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Try again</button>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : showModal ? (
            /* ── EMBEDDED RECORDING SECTION (replaces the old modal overlay) ─────── */
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: 28 }}>
              <div style={{ width: '100%', maxWidth: isReview ? 720 : 560, height: 'fit-content', background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 32 }}>
                {/* Pre-mood */}
                {showPreMood && !isCapturing && (
                  <>
                    <p style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 300, color: TEXT, margin: '0 0 6px' }}>How are you feeling?</p>
                    <p style={{ fontSize: 13, color: MUTED, margin: '0 0 24px' }}>Before starting the session</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 28 }}>
                      {SESSION_MOODS.map((m, i) => (
                        <button key={i} onClick={() => setPreRecordMoodIdx(i)}
                          style={{ width: 48, height: 48, boxSizing: 'border-box', flexShrink: 0, borderRadius: 12, border: `2px solid ${preRecordMoodIdx === i ? A : BORDER}`, background: preRecordMoodIdx === i ? A + '18' : 'transparent', fontSize: 24, cursor: 'pointer' }}>
                          {m.emoji}
                        </button>
                      ))}
                    </div>

                    {/* Источник звука */}
                    <div style={{ marginBottom: 24 }}>
                      <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Источник звука</p>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                        {[
                          { id: 'mic', label: '🎤 Микрофон', hint: 'запись вживую' },
                          { id: 'tab', label: '🔊 Звук вкладки', hint: 'Zoom / онлайн' },
                        ].map(opt => {
                          const on = captureSource === opt.id;
                          return (
                            <button key={opt.id} onClick={() => setCaptureSource(opt.id)}
                              style={{ flex: 1, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                                       border: `1.5px solid ${on ? A : BORDER}`, background: on ? A + '12' : 'transparent' }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: on ? A : TEXT }}>{opt.label}</div>
                              <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{opt.hint}</div>
                            </button>
                          );
                        })}
                      </div>
                      {captureSource === 'mic' && micDevices.length > 0 && (
                        <select value={selectedMicId} onChange={e => setSelectedMicId(e.target.value)}
                          style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 10, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 13, fontFamily: 'inherit', outline: 'none' }}>
                          <option value="">Микрофон по умолчанию</option>
                          {micDevices.map((d, i) => (
                            <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Микрофон ${i + 1}`}</option>
                          ))}
                        </select>
                      )}
                      {captureSource === 'tab' && (
                        <p style={{ fontSize: 11.5, color: MUTED, margin: 0, lineHeight: 1.5 }}>
                          Откроется окно выбора — выберите вкладку со звонком и поставьте галочку «Поделиться звуком вкладки».
                        </p>
                      )}
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
                    {/* A long session spends minutes just getting to the server —
                        show that it is moving instead of an opaque spinner. */}
                    <p style={{ fontSize: 16, color: TEXT, margin: 0 }}>
                      {uploadProgress > 0 && uploadProgress < 100 ? `Загрузка записи… ${uploadProgress}%` : 'Transcribing…'}
                    </p>
                    {uploadProgress > 0 && uploadProgress < 100 && (
                      <div style={{ width: '70%', height: 5, borderRadius: 3, background: BORDER, margin: '12px auto 0', overflow: 'hidden' }}>
                        <div style={{ width: `${uploadProgress}%`, height: '100%', background: A, transition: 'width .2s' }} />
                      </div>
                    )}
                    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                  </div>
                )}

                {/* Capturing — the ritual screen: a glowing eye, its halo
                    breathing, the level meter as its lashes, and the two
                    controls as quiet pills. */}
                {isCapturing && !isTranscribing && (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '18px 0 8px' }}>

                      {/* Eye + halo */}
                      <div style={{ position: 'relative', width: 210, height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {/* Centred with margins, not transform: the breathing
                            keyframes animate transform, which would otherwise
                            replace the centring translate and shove the halo
                            off to one side. */}
                        <span className={`eye-glow${isPaused ? '' : ' ritual-halo'}`}
                          style={{ width: 260, height: 260, left: '50%', top: '50%', marginLeft: -130, marginTop: -130 }} />
                        <svg width="150" height="98" viewBox="0 0 150 98" fill="none" style={{ position: 'relative', overflow: 'visible' }} aria-hidden="true">
                          {/* Concentric rings — outermost faintest */}
                          <ellipse cx="75" cy="49" rx="72" ry="45" fill="none" stroke={A} strokeWidth="1"   opacity={isPaused ? 0.16 : 0.30} />
                          <ellipse cx="75" cy="49" rx="57" ry="35" fill="none" stroke={A} strokeWidth="1.1" opacity={isPaused ? 0.22 : 0.45} />
                          <ellipse cx="75" cy="49" rx="42" ry="26" fill="none" stroke={A} strokeWidth="1.4" opacity={isPaused ? 0.30 : 0.72} />
                          <circle  cx="75" cy="49" r="15" fill={ACCENT_DEEP} opacity={isPaused ? 0.45 : 1} />
                          <circle  cx="80" cy="43" r="4.4" fill={SURFACE} opacity="0.85" />
                        </svg>
                      </div>

                      {/* Serif status + elapsed */}
                      <p style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 25, color: TEXT, margin: '10px 0 2px', letterSpacing: '0.01em' }}>
                        {isPaused ? 'Paused' : 'Listening…'}
                      </p>
                      <p style={{ fontFamily: 'var(--font-serif)', fontSize: 32, color: A, margin: '0 0 4px', letterSpacing: '0.03em' }}>
                        {fmt(seconds)}
                      </p>

                      {/* Breathing equaliser — the same AudioLevelMeter, restyled */}
                      <div style={{ width: '100%', maxWidth: 340, padding: '10px 0 2px', display: 'flex', justifyContent: 'center' }}>
                        <AudioLevelMeter stream={mediaRef.current?.stream} source={captureSource} paused={isPaused} A={A} MUTED={MUTED} TEXT={TEXT} />
                      </div>

                      {/* Pill controls */}
                      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                        {isPaused
                          ? <button onClick={resumeRecording}
                              style={{ padding: '11px 30px', borderRadius: 999, border: 'none', background: ACCENT_DEEP, color: isDark ? BG : '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer', letterSpacing: '0.02em' }}>
                              ▶ Resume
                            </button>
                          : <button onClick={pauseRecording}
                              style={{ padding: '11px 30px', borderRadius: 999, border: `1px solid ${A}`, background: 'transparent', color: A, fontSize: 14, fontWeight: 500, cursor: 'pointer', letterSpacing: '0.02em' }}>
                              ⏸ Pause
                            </button>}
                        <button onClick={stopRecording}
                          style={{ padding: '11px 32px', borderRadius: 999, border: 'none', background: ACCENT_DEEP, color: isDark ? BG : '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer', letterSpacing: '0.02em' }}>
                          ⏹ Stop
                        </button>
                      </div>
                    </div>
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

                    {/* Transcription failed — the audio is still held, so offer the
                        one thing that actually helps: run it again. */}
                    {transcribeFailed && (
                      <div style={{ background: '#DC262610', border: '1px solid #DC262633', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: '#DC2626', margin: '0 0 6px' }}>⚠ Расшифровка не удалась</p>
                        <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 12px', lineHeight: 1.6 }}>
                          Запись не потеряна — она сохранена на этом устройстве
                          {pendingAudioRef.current?.blob ? ` (${(pendingAudioRef.current.blob.size / 1024 / 1024).toFixed(1)} МБ)` : ''}.
                          Можно повторить попытку, или сохранить сессию сейчас и вписать текст вручную.
                        </p>
                        <button onClick={transcribePending} disabled={isTranscribing}
                          style={{ padding: '8px 18px', borderRadius: 9, border: 'none', background: A, color: '#fff', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>
                          ↻ Повторить расшифровку
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
                        style={{ padding: '11px 30px', borderRadius: 999, border: 'none', background: selectedSession?.transcript ? ACCENT_DEEP : BORDER, color: selectedSession?.transcript && isDark ? BG : '#fff', fontSize: 14, fontWeight: 500, cursor: selectedSession?.transcript ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 8 }}>
                        {analysing ? '⏳ Analysing…' : '✦ Analyse'}
                      </button>
                      {/* Dead end otherwise: say how to get a transcript, and go there. */}
                      {!selectedSession?.transcript && (
                        <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>
                          Session needs a transcript to analyse —{' '}
                          <button onClick={() => setActiveTab('transcript')}
                            style={{ padding: 0, border: 'none', background: 'none', color: A, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}>
                            вставить вручную
                          </button>
                        </p>
                      )}
                    </div>
                  );
                  const SECTIONS = [...ANALYSIS_FIELDS, ...LEGACY_ANALYSIS_FIELDS];
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                        {analyseError && <span style={{ fontSize: 12, color: '#DC2626' }}>{analyseError}</span>}
                        <button onClick={analyseSession} disabled={analysing}
                          style={{ padding: '6px 14px', borderRadius: 9, border: `1px solid ${BORDER}`, background: 'transparent', color: analysing ? MUTED : A, fontSize: 12.5, fontWeight: 500, cursor: analysing ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {analysing ? '⏳ Re-analysing…' : '↻ Re-analyze'}
                        </button>
                      </div>
                      {SECTIONS.filter(({ key }) => hasValue(ai[key])).map(({ key, label, color }) => (
                        <div key={key} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${color}`, borderRadius: 12, padding: '16px 18px' }}>
                          <p className="ritual-label" style={{ margin: '0 0 8px' }}>{label}</p>
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
                  const hasTranscript = !!selectedSession.transcript;
                  // With no transcript the editor IS the empty state — there is
                  // nothing to look at, so don't make the user hunt for "Edit".
                  const editing = editingTranscript || !hasTranscript;

                  if (editing) {
                    return (
                      <div>
                        {!hasTranscript && (
                          <p style={{ fontSize: 13.5, color: MUTED, margin: '0 0 12px', lineHeight: 1.6 }}>
                            Транскрипта нет. Вставьте или напишите текст вручную — после сохранения станут доступны AI-анализ и поиск по сессии.
                          </p>
                        )}
                        <textarea value={transcriptDraft} onChange={e => setTranscriptDraft(e.target.value)}
                          placeholder="Вставьте текст транскрипта…"
                          style={{ width: '100%', boxSizing: 'border-box', minHeight: 340, padding: '14px 16px', borderRadius: 12, border: `1px solid ${BORDER}`, background: SURFACE, color: TEXT, fontSize: 14, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.8 }} />
                        {transcriptError && <p style={{ fontSize: 12.5, color: '#DC2626', margin: '10px 0 0' }}>⚠ {transcriptError}</p>}
                        <div style={{ marginTop: 12, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                          {hasTranscript && (
                            <button onClick={cancelEditTranscript} disabled={savingTranscript}
                              style={{ padding: '9px 20px', borderRadius: 10, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 13, cursor: 'pointer' }}>
                              Cancel
                            </button>
                          )}
                          <button onClick={saveTranscript} disabled={savingTranscript || !transcriptDraft.trim()}
                            style={{ padding: '9px 24px', borderRadius: 10, border: 'none', background: transcriptDraft.trim() ? A : BORDER, color: '#fff', fontSize: 13, fontWeight: 500, cursor: transcriptDraft.trim() ? 'pointer' : 'default' }}>
                            {savingTranscript ? 'Saving…' : (hasTranscript ? 'Save' : 'Save transcript')}
                          </button>
                        </div>
                      </div>
                    );
                  }

                  const editBar = (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                      <button onClick={startEditTranscript}
                        style={{ padding: '7px 16px', borderRadius: 9, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 12.5, cursor: 'pointer' }}>
                        ✎ Edit
                      </button>
                    </div>
                  );

                  const parsed = parseSpeakerTurns(selectedSession.transcript);
                  if (!parsed)
                    return (
                      <div>
                        {editBar}
                        <p style={{ fontSize: 14, color: TEXT, lineHeight: 1.9, whiteSpace: 'pre-wrap', margin: 0 }}>{selectedSession.transcript}</p>
                      </div>
                    );
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {editBar}
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
        <div className="sessions-chat" style={{ borderLeft: `1px solid ${BORDER}`, background: SURFACE }}>
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
