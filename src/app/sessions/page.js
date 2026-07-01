'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { sessions as sessionsApi, emotions as emotionsApi } from '@/lib/api';

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

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
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
  const [loading,         setLoading]         = useState(true);
  const [searchQuery,     setSearchQuery]     = useState('');
  const [selectedSession, setSelectedSession] = useState(null);
  const [activeTab,       setActiveTab]       = useState('summary');
  const [sessionNotes,    setSessionNotes]    = useState('');
  const [savingNotes,     setSavingNotes]     = useState(false);

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
  const [liveTranscript,     setLiveTranscript]     = useState('');

  // right panel chat
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput,    setChatInput]    = useState('');
  const [chatLoading,  setChatLoading]  = useState(false);
  const chatBottomRef = useRef(null);

  const timerRef       = useRef(null);
  const mediaRef       = useRef(null);
  const chunksRef      = useRef([]);
  const recognitionRef = useRef(null);
  const finalTextRef   = useRef('');

  // ── load sessions ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    sessionsApi.list(supabase)
      .then(d => { setSessions(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [supabase]);

  // ── auto-open record modal from URL param ────────────────────────────────────
  useEffect(() => {
    if (searchParams.get('record') === 'true') {
      openRecordModal();
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
  function openRecordModal() {
    setShowModal(true);
    setShowPreMood(true);
    setPreRecordMoodIdx(null);
    setSpeechError('');
    setTranscript('');
    setRecNotes('');
    setLiveTranscript('');
    finalTextRef.current = '';
    chunksRef.current = [];
  }

  function closeModal() {
    if (isCapturing) stopRecording();
    if (recognitionRef.current) { recognitionRef.current.onend = null; try { recognitionRef.current.stop(); } catch(_) {} recognitionRef.current = null; }
    clearInterval(timerRef.current);
    setShowModal(false); setIsCapturing(false); setIsTranscribing(false); setIsReview(false);
    setSeconds(0); setTranscript(''); setRecNotes(''); setSaved(false);
    setShowPreMood(false); setPreRecordMoodIdx(null);
    setPostRecordMoodIdx(null); setPostMoodSaved(false);
    setSpeechError(''); setSaveError(''); setLiveTranscript('');
    finalTextRef.current = ''; chunksRef.current = [];
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
    setSpeechError(''); setTranscript(''); setLiveTranscript('');
    finalTextRef.current = ''; chunksRef.current = [];

    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setSpeechError('Microphone access denied.'); return; }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const recognition = new SR();
      recognition.continuous = true; recognition.interimResults = true; recognition.lang = navigator.language;
      recognition.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalTextRef.current += t + ' ';
          else interim += t;
        }
        setLiveTranscript(finalTextRef.current + interim);
      };
      recognition.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') console.warn('[Speech]', e.error); };
      recognition.onend = () => { if (mediaRef.current) { try { recognition.start(); } catch(_) {} } };
      recognition.start();
      recognitionRef.current = recognition;
    }

    const mimeType = getSupportedMimeType();
    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRef.current = mr;
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onerror = (e) => { setSpeechError('Recording error: ' + (e?.error?.message || 'unknown')); clearInterval(timerRef.current); setIsCapturing(false); };
    mr.start(1000);
    setIsCapturing(true); setSeconds(0);
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
  }

  async function stopRecording() {
    clearInterval(timerRef.current);
    setIsCapturing(false);
    if (recognitionRef.current) { recognitionRef.current.onend = null; try { recognitionRef.current.stop(); } catch(_) {} recognitionRef.current = null; }
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

    const liveText = finalTextRef.current.trim();
    if (liveText) setTranscript(liveText);

    setIsTranscribing(true);
    try {
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      const form = new FormData();
      form.append('audio', audioBlob, `recording.${ext}`);
      form.append('language', navigator.language.slice(0, 2));
      const res = await fetch('/api/transcribe', { method: 'POST', body: form });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTranscript(data.text || liveText || '');
    } catch (err) {
      console.error('[transcribe]', err);
      setSpeechError('Transcription error: ' + err.message);
      if (liveText) setTranscript(liveText);
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
        title:    recNotes.slice(0, 60) || `Session ${new Date().toLocaleDateString()}`,
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
    await sessionsApi.delete(supabase, s.id);
    setSessions(list => list.filter(x => x.id !== s.id));
    if (selectedSession?.id === s.id) setSelectedSession(null);
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
      const systemPrompt = selectedSession?.transcript
        ? `You are a compassionate AI therapy companion. The user is reviewing a therapy session.\n\nSession transcript:\n"${selectedSession.transcript.slice(0, 3000)}"\n\nBe concise, warm, and insightful.`
        : 'You are a compassionate AI therapy companion. Be concise, warm, and insightful.';
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, systemPrompt }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setChatMessages([...next, { role: 'assistant', content: data.content }]);
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

        {/* ── RECORDING MODAL ─────────────────────────────────────────────────── */}
        {showModal && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: SURFACE, borderRadius: 20, padding: 36, width: 460, maxWidth: '90%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
              {/* Pre-mood */}
              {showPreMood && !isCapturing && (
                <>
                  <p style={{ fontFamily: '"Fraunces", serif', fontSize: 22, fontWeight: 300, color: TEXT, margin: '0 0 6px' }}>How are you feeling?</p>
                  <p style={{ fontSize: 13, color: MUTED, margin: '0 0 24px' }}>Before starting the session</p>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 28 }}>
                    {SESSION_MOODS.map((m, i) => (
                      <button key={i} onClick={() => setPreRecordMoodIdx(i)}
                        style={{ width: 48, height: 48, borderRadius: 12, border: `2px solid ${preRecordMoodIdx === i ? A : BORDER}`, background: preRecordMoodIdx === i ? A + '18' : 'transparent', fontSize: 24, cursor: 'pointer' }}>
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
                  <div style={{ minHeight: 72, padding: '12px 14px', borderRadius: 10, background: BG, border: `1px solid ${BORDER}`, fontSize: 14, lineHeight: 1.7 }}>
                    {liveTranscript
                      ? <span style={{ color: TEXT }}>{liveTranscript}<span style={{ animation: 'blink 1s step-end infinite', color: A }}>|</span></span>
                      : <span style={{ color: MUTED }}>Speak — text will appear here…</span>}
                  </div>
                  <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
                </>
              )}

              {/* Review */}
              {isReview && !isCapturing && !isTranscribing && (
                <>
                  <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Review · {fmt(seconds)}</p>

                  {!postMoodSaved && (
                    <div style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: TEXT, margin: '0 0 10px' }}>How do you feel now?</p>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                        {SESSION_MOODS.map((m, i) => (
                          <button key={i} onClick={() => setPostRecordMoodIdx(i)}
                            style={{ width: 38, height: 38, borderRadius: 9, border: `2px solid ${postRecordMoodIdx === i ? A : BORDER}`, background: postRecordMoodIdx === i ? A + '18' : 'transparent', fontSize: 20, cursor: 'pointer' }}>
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
                    style={{ width: '100%', boxSizing: 'border-box', minHeight: 110, padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.7, marginBottom: 12 }} />

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
        )}

        {/* ── LEFT COLUMN ─────────────────────────────────────────────────────── */}
        <div style={{ width: 280, flexShrink: 0, borderRight: `1px solid ${BORDER}`, background: SURFACE, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: A, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
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
                  <p style={{ fontSize: 10, fontWeight: 600, color: MUTED, margin: '14px 6px 6px', textTransform: 'uppercase', letterSpacing: '0.09em' }}>{label}</p>
                  {list.map(s => (
                    <div key={s.id} onClick={() => selectSession(s)}
                      style={{ padding: '10px 10px', borderRadius: 10, marginBottom: 2, cursor: 'pointer', background: selectedSession?.id === s.id ? A + '15' : 'transparent', border: `1px solid ${selectedSession?.id === s.id ? A + '40' : 'transparent'}`, transition: 'background 0.1s' }}
                      onMouseEnter={e => { if (selectedSession?.id !== s.id) e.currentTarget.style.background = BG; }}
                      onMouseLeave={e => { if (selectedSession?.id !== s.id) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                        <p style={{ fontSize: 12, fontWeight: 500, color: selectedSession?.id === s.id ? A : TEXT, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {s.title || 'Untitled'}
                        </p>
                        {s.ai_analysis && (
                          <span style={{ fontSize: 9, fontWeight: 600, color: '#8B5CF6', background: '#8B5CF615', padding: '1px 5px', borderRadius: 4, marginLeft: 6, flexShrink: 0 }}>AI</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <p style={{ fontSize: 11, color: MUTED, margin: 0 }}>
                          {new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          {s.duration ? ` · ${fmt(s.duration)}` : ''}
                        </p>
                      </div>
                      {s.transcript && (
                        <p style={{ fontSize: 11, color: MUTED, margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.8 }}>
                          {s.transcript.slice(0, 60)}…
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )
            ))}
          </div>
        </div>

        {/* ── CENTER COLUMN ───────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', background: BG }}>
          {!selectedSession ? (
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
                      {selectedSession.title || 'Untitled session'}
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
                      <button style={{ padding: '11px 28px', borderRadius: 12, border: 'none', background: A, color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                        ✦ Analyse
                      </button>
                    </div>
                  );
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {[
                        { key: 'overview',     label: 'OVERVIEW',     color: '#3B82F6' },
                        { key: 'key_theme',    label: 'KEY THEME',    color: '#8B5CF6' },
                        { key: 'breakthrough', label: 'BREAKTHROUGH', color: '#10B981' },
                        { key: 'action',       label: 'ACTION',       color: '#F59E0B' },
                      ].filter(({ key }) => ai[key]).map(({ key, label, color }) => (
                        <div key={key} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${color}`, borderRadius: 12, padding: '16px 18px' }}>
                          <p style={{ fontSize: 10, fontWeight: 700, color, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</p>
                          <p style={{ fontSize: 14, color: TEXT, margin: 0, lineHeight: 1.7 }}>{ai[key]}</p>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Transcript tab */}
                {activeTab === 'transcript' && (
                  selectedSession.transcript
                    ? <p style={{ fontSize: 14, color: TEXT, lineHeight: 1.9, whiteSpace: 'pre-wrap', margin: 0 }}>{selectedSession.transcript}</p>
                    : <p style={{ fontSize: 14, color: MUTED }}>No transcript for this session.</p>
                )}

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
          {/* Header */}
          <div style={{ padding: '16px 16px 12px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: TEXT, margin: 0 }}>Session AI</p>
            <button onClick={() => setChatMessages([])}
              style={{ fontSize: 12, color: MUTED, background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 7, padding: '4px 10px', cursor: 'pointer' }}>
              + New chat
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px' }}>
            {chatMessages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <p style={{ fontSize: 13, color: MUTED, margin: '0 0 16px', lineHeight: 1.6 }}>
                  {selectedSession ? `Ask me about "${selectedSession.title || 'this session'}"` : 'Select a session, then ask me anything about it.'}
                </p>
                {selectedSession && (
                  <button onClick={() => sendChat('What was my key insight today?')}
                    style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 12, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                    💡 What was my key insight today?
                  </button>
                )}
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
