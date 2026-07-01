'use client';
import { useState, useEffect, useRef } from 'react';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/components/AuthProvider';
import { useTheme } from '@/lib/ThemeContext';
import { sessions as sessionsApi, emotions as emotionsApi } from '@/lib/api';

const SESSION_MOODS = [
  { emoji: '😞', intensity: 2 },
  { emoji: '😟', intensity: 4 },
  { emoji: '😐', intensity: 6 },
  { emoji: '🙂', intensity: 8 },
  { emoji: '😊', intensity: 10 },
];

function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

export default function SessionsPage() {
  const { supabase, user } = useAuth();
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL: A, NAV_ACTIVE: ABG } = useTheme();

  useEffect(() => {
    console.log('[Sessions] user:', user?.id ?? 'null');
  }, [user]);

  const [sessions,          setSessions]          = useState([]);
  const [loading,           setLoading]           = useState(true);
  const [isCapturing,       setIsCapturing]       = useState(false);
  const [isTranscribing,    setIsTranscribing]    = useState(false);
  const [isReview,          setIsReview]          = useState(false);
  const [seconds,           setSeconds]           = useState(0);
  const [transcript,        setTranscript]        = useState('');
  const [notes,             setNotes]             = useState('');
  const [saving,            setSaving]            = useState(false);
  const [saved,             setSaved]             = useState(false);
  const [showPreMood,       setShowPreMood]       = useState(false);
  const [preRecordMoodIdx,  setPreRecordMoodIdx]  = useState(null);
  const [postRecordMoodIdx, setPostRecordMoodIdx] = useState(null);
  const [postMoodSaved,     setPostMoodSaved]     = useState(false);
  const [savingMood,        setSavingMood]        = useState(false);
  const [speechError,       setSpeechError]       = useState('');
  const [saveError,         setSaveError]         = useState('');

  const timerRef   = useRef(null);
  const mediaRef   = useRef(null);
  const chunksRef  = useRef([]);

  useEffect(() => {
    if (!supabase) return;
    sessionsApi.list(supabase)
      .then(d => { setSessions(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [supabase]);

  // ── Pre-mood ────────────────────────────────────────────────────────────────
  function handleRecord() {
    setShowPreMood(true);
    setPreRecordMoodIdx(null);
  }

  async function startAfterPreMood() {
    if (preRecordMoodIdx !== null && user) {
      const m = SESSION_MOODS[preRecordMoodIdx];
      try {
        await emotionsApi.save(supabase, {
          category: 'Session', emotion_name: 'Before', intensity: m.intensity, session_tag: 'before',
        });
      } catch (e) { console.error('[Sessions] pre-mood save:', e?.message); }
    }
    setShowPreMood(false);
    startRecording();
  }

  // ── Recording ───────────────────────────────────────────────────────────────
  async function startRecording() {
    setSpeechError('');
    setTranscript('');
    chunksRef.current = [];

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setSpeechError('Microphone access denied. Please allow access in your browser settings.');
      return;
    }

    const mimeType = getSupportedMimeType();
    const options = mimeType ? { mimeType } : {};
    const mr = new MediaRecorder(stream, options);
    mediaRef.current = mr;

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mr.onerror = (e) => {
      console.error('[Recording] MediaRecorder error:', e?.error);
      setSpeechError('Recording error: ' + (e?.error?.message || 'unknown'));
      clearInterval(timerRef.current);
      setIsCapturing(false);
    };

    mr.start(1000);
    setIsCapturing(true);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
  }

  function getSupportedMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }

  async function stopRecording() {
    clearInterval(timerRef.current);
    setIsCapturing(false);

    if (!mediaRef.current) return;

    // Stop and collect final chunk
    await new Promise(resolve => {
      mediaRef.current.onstop = resolve;
      mediaRef.current.stop();
    });
    mediaRef.current.stream.getTracks().forEach(t => t.stop());

    const mimeType = mediaRef.current.mimeType || 'audio/webm';
    const chunks = chunksRef.current.slice();
    mediaRef.current = null;

    const audioBlob = new Blob(chunks, { type: mimeType });
    console.log('[Recording] mimeType:', mimeType, 'chunks:', chunks.length, 'size:', audioBlob.size, 'bytes');

    if (audioBlob.size < 1000) {
      setSpeechError(`Recording too short or empty (${chunks.length} chunks, ${audioBlob.size} bytes). Try speaking louder or check microphone permissions.`);
      setIsReview(true);
      return;
    }

    // Pick correct file extension based on mimeType
    const ext = mimeType.includes('mp4') ? 'mp4'
              : mimeType.includes('ogg') ? 'ogg'
              : 'webm';

    // Send to AssemblyAI
    setIsTranscribing(true);
    try {
      const form = new FormData();
      form.append('audio', audioBlob, `recording.${ext}`);
      const res = await fetch('/api/transcribe', { method: 'POST', body: form });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTranscript(data.text || '');
    } catch (err) {
      console.error('[transcribe]', err);
      setSpeechError('Transcription error: ' + err.message);
    } finally {
      setIsTranscribing(false);
      setIsReview(true);
    }
  }

  // ── Post-mood ───────────────────────────────────────────────────────────────
  async function savePostMood() {
    if (postRecordMoodIdx === null) return;
    if (!user) { setPostMoodSaved(true); return; }
    setSavingMood(true);
    const m = SESSION_MOODS[postRecordMoodIdx];
    try {
      await emotionsApi.save(supabase, {
        category: 'Session', emotion_name: 'After', intensity: m.intensity, session_tag: 'after',
      });
      setPostMoodSaved(true);
    } catch (e) { console.error('[Sessions] post-mood save:', e?.message); }
    finally { setSavingMood(false); }
  }

  // ── Save session ─────────────────────────────────────────────────────────────
  async function saveSession() {
    if (!user) { setSaveError('Not signed in — please sign in to save.'); return; }
    setSaving(true);
    setSaveError('');
    try {
      const preMood  = preRecordMoodIdx  !== null ? SESSION_MOODS[preRecordMoodIdx].intensity  : null;
      const postMood = postRecordMoodIdx !== null ? SESSION_MOODS[postRecordMoodIdx].intensity : null;
      console.log('[Sessions] saving, user:', user.id, 'duration:', seconds);
      const result = await sessionsApi.save(supabase, {
        title:       notes.slice(0, 60) || `Session ${new Date().toLocaleDateString()}`,
        transcript,
        notes,
        duration:    seconds,
        mood_before: preMood,
        mood_after:  postMood,
      });
      console.log('[Sessions] saved, id:', result?.id);
      setSessions(s => [result, ...s]);
      setSaved(true);
      setTimeout(resetAll, 2000);
    } catch (err) {
      console.error('[Sessions] save error:', err?.message, err?.code, err?.details);
      setSaveError('Failed to save: ' + (err?.message || 'unknown error'));
    } finally { setSaving(false); }
  }

  function resetAll() {
    setIsCapturing(false); setIsReview(false); setIsTranscribing(false);
    setSeconds(0); setTranscript(''); setNotes(''); setSaved(false);
    setShowPreMood(false); setPreRecordMoodIdx(null);
    setPostRecordMoodIdx(null); setPostMoodSaved(false);
    setSpeechError(''); setSaveError(''); chunksRef.current = [];
  }

  // ── Pre-mood screen ─────────────────────────────────────────────────────────
  if (showPreMood && !isCapturing) return (
    <AppLayout>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG }}>
        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 20, padding: 40, maxWidth: 440, width: '100%', textAlign: 'center' }}>
          <p style={{ fontFamily: '"Fraunces", serif', fontSize: 26, fontWeight: 300, color: TEXT, margin: '0 0 8px' }}>How are you feeling?</p>
          <p style={{ fontSize: 14, color: MUTED, margin: '0 0 28px' }}>Before starting the session</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 28 }}>
            {SESSION_MOODS.map((m, i) => (
              <button key={i} onClick={() => setPreRecordMoodIdx(i)}
                style={{ width: 52, height: 52, borderRadius: 14, border: `2px solid ${preRecordMoodIdx === i ? A : BORDER}`, background: preRecordMoodIdx === i ? A + '18' : 'transparent', fontSize: 26, cursor: 'pointer', transition: 'all 0.12s' }}>
                {m.emoji}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => { setShowPreMood(false); startRecording(); }}
              style={{ flex: 1, padding: '11px', borderRadius: 12, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 14, cursor: 'pointer' }}>
              Skip
            </button>
            <button onClick={startAfterPreMood}
              style={{ flex: 2, padding: '11px', borderRadius: 12, border: 'none', background: A, color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
              Start Recording
            </button>
          </div>
        </div>
      </div>
    </AppLayout>
  );

  // ── Transcribing screen ─────────────────────────────────────────────────────
  if (isTranscribing) return (
    <AppLayout>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, border: `3px solid ${BORDER}`, borderTop: `3px solid ${A}`, borderRadius: '50%', margin: '0 auto 20px', animation: 'spin 1s linear infinite' }} />
          <p style={{ fontFamily: '"Fraunces", serif', fontSize: 22, fontWeight: 300, color: TEXT, margin: '0 0 8px' }}>Transcribing…</p>
          <p style={{ fontSize: 14, color: MUTED }}>Detecting language and transcribing your recording</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: BG, fontFamily: '"Plus Jakarta Sans", sans-serif', color: TEXT, paddingBottom: 60 }}>
        <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>
          <div style={{ marginBottom: 32 }}>
            <h1 style={{ fontFamily: '"Fraunces", serif', fontSize: 32, fontWeight: 300, color: TEXT, margin: '0 0 4px' }}>Sessions</h1>
            <p style={{ fontSize: 15, color: MUTED, margin: 0 }}>Record and review your therapy sessions</p>
          </div>

          {!isReview ? (
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 32, marginBottom: 28 }}>
              {!isCapturing ? (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontFamily: '"Fraunces", serif', fontSize: 22, fontWeight: 300, color: TEXT, margin: '0 0 8px' }}>Ready to record?</p>
                  <p style={{ fontSize: 13, color: MUTED, margin: '0 0 24px' }}>Language is detected automatically</p>
                  {speechError && <p style={{ fontSize: 13, color: A, margin: '0 0 16px' }}>{speechError}</p>}
                  <button onClick={handleRecord}
                    style={{ padding: '14px 40px', borderRadius: 14, border: 'none', background: A, color: '#fff', fontSize: 16, fontWeight: 500, cursor: 'pointer' }}>
                    ⏺ Start Recording
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#EF4444', animation: 'pulse 1s infinite' }} />
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#EF4444' }}>Recording</span>
                    </div>
                    <p style={{ fontFamily: '"Fraunces", serif', fontSize: 32, fontWeight: 300, color: TEXT, margin: 0 }}>{fmt(seconds)}</p>
                    <button onClick={stopRecording}
                      style={{ padding: '10px 28px', borderRadius: 12, border: 'none', background: '#EF4444', color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                      ⏹ Stop
                    </button>
                  </div>
                  <div style={{ padding: '14px 16px', borderRadius: 10, background: BG, border: `1px solid ${BORDER}`, fontSize: 14, color: MUTED }}>
                    Speak in any language — transcript ready after you stop
                  </div>
                  <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
                </div>
              )}
            </div>
          ) : (
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 28, marginBottom: 28 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 16px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Review · {fmt(seconds)}</p>

              {!postMoodSaved ? (
                <div style={{ background: ABG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: TEXT, margin: '0 0 12px' }}>How do you feel now?</p>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    {SESSION_MOODS.map((m, i) => (
                      <button key={i} onClick={() => setPostRecordMoodIdx(i)}
                        style={{ width: 40, height: 40, borderRadius: 10, border: `2px solid ${postRecordMoodIdx === i ? A : BORDER}`, background: postRecordMoodIdx === i ? A + '18' : 'transparent', fontSize: 22, cursor: 'pointer' }}>
                        {m.emoji}
                      </button>
                    ))}
                  </div>
                  <button onClick={savePostMood} disabled={postRecordMoodIdx === null || savingMood}
                    style={{ padding: '8px 20px', borderRadius: 10, border: 'none', background: postRecordMoodIdx !== null ? A : BORDER, color: '#fff', fontSize: 13, fontWeight: 500, cursor: postRecordMoodIdx !== null ? 'pointer' : 'default' }}>
                    {savingMood ? 'Saving…' : 'Save mood'}
                  </button>
                </div>
              ) : (
                <p style={{ fontSize: 13, color: '#15803D', margin: '0 0 16px' }}>✓ Mood saved</p>
              )}

              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Transcript</p>
                {speechError && <p style={{ fontSize: 13, color: A, margin: '0 0 8px' }}>{speechError}</p>}
                <textarea value={transcript} onChange={e => setTranscript(e.target.value)}
                  placeholder="No transcript — you can type notes manually"
                  style={{ width: '100%', boxSizing: 'border-box', minHeight: 140, padding: '12px 16px', borderRadius: 10, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 14, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.7 }} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Notes</p>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Add session notes…"
                  style={{ width: '100%', boxSizing: 'border-box', minHeight: 80, padding: '12px 16px', borderRadius: 10, border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 14, resize: 'vertical', outline: 'none', fontFamily: 'inherit', lineHeight: 1.7 }} />
              </div>

              {saveError && <p style={{ fontSize: 13, color: '#DC2626', margin: '0 0 12px' }}>⚠ {saveError}</p>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={resetAll}
                  style={{ flex: 1, padding: '12px', borderRadius: 12, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, fontSize: 14, cursor: 'pointer' }}>
                  Discard
                </button>
                <button onClick={saveSession} disabled={saving || saved}
                  style={{ flex: 2, padding: '12px', borderRadius: 12, border: 'none', background: saved ? '#15803D' : A, color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                  {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Session'}
                </button>
              </div>
            </div>
          )}

          <p style={{ fontSize: 12, fontWeight: 600, color: MUTED, margin: '0 0 14px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Past Sessions ({sessions.length})</p>
          {loading && <p style={{ color: MUTED }}>Loading…</p>}
          {!loading && sessions.length === 0 && <p style={{ color: MUTED, fontSize: 15 }}>No sessions yet.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sessions.map(s => (
              <div key={s.id} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 15, fontWeight: 500, color: TEXT, margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || 'Untitled session'}</p>
                  <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>{new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{s.duration ? ` · ${fmt(s.duration)}` : ''}</p>
                </div>
                {s.mood_before != null && s.mood_after != null && (
                  <p style={{ fontSize: 13, color: MUTED, margin: 0, flexShrink: 0 }}>{s.mood_before}/10 → {s.mood_after}/10</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
