// Crash-safe holding pen for recordings whose session hasn't been saved yet.
//
// A 91-minute session was lost when the upload to AssemblyAI died: the blob only
// ever lived in a React ref, so the error also ended the recording. Now the blob
// goes to IndexedDB the moment recording stops, and is only deleted once the
// session is actually saved (or explicitly discarded) — a reload, a crash or a
// closed tab no longer costs the user the session.
//
// Each recording has its own record, under its own id. There used to be one
// slot ('current'): a new recording stopping overwrote whatever was waiting
// there, so a 93-minute session held unsaved for a week was one stray tap of
// Record away from being gone. A record written under 'current' by that older
// version is still read, and offered back like any other.
//
// While recording, the audio is written here as it is captured (a "live"
// record plus numbered chunks, see startLiveRecording). Before that, everything
// up to Stop lived only in the tab's memory: a closed tab, a reload, a crash or
// a laptop that went to sleep mid-session lost the whole recording without a
// trace. Now whatever reached disk comes back as an interrupted recording.
//
// It stays on the user's own device: this is therapy audio, so it is never
// uploaded anywhere except AssemblyAI for transcription, and it is cleared as
// soon as the transcript is safely saved.

const DB_NAME = 'therapy-journey';
const STORE = 'pending-recording';
export const LEGACY_KEY = 'current';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Runs fn against the store; resolves with whatever fn returns, read after the
// transaction commits (requests' results are only final then).
function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(typeof out === 'function' ? out() : out?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function newRecordingId(now = Date.now()) {
  return `rec-${now}-${Math.random().toString(36).slice(2, 8)}`;
}

// When the recording was made. Older records only have savedAt (the moment it
// stopped); the start is that minus its length.
function withRecordedAt(rec) {
  if (Number.isFinite(rec.recordedAt)) return rec;
  const saved = Number.isFinite(rec.savedAt) ? rec.savedAt : null;
  return { ...rec, recordedAt: saved === null ? null : saved - (rec.seconds || 0) * 1000 };
}

// Every call is best-effort: private windows and blocked site data throw, and a
// failure to cache the blob must never take down the recording flow itself.
//
// Returns the new record's id, or null when it could not be held. Never
// touches any other record.
export async function savePendingRecording({ blob, mimeType, seconds, recordedAt }, { now = Date.now } = {}) {
  try {
    const savedAt = now();
    const id = newRecordingId(savedAt);
    const rec = {
      id, blob, mimeType, seconds, savedAt,
      recordedAt: Number.isFinite(recordedAt) ? recordedAt : savedAt - (seconds || 0) * 1000,
    };
    const db = await openDb();
    await tx(db, 'readwrite', s => s.put(rec, id));
    db.close();
    return id;
  } catch (e) {
    console.warn('[recordingStore] save failed:', e?.message);
    return null;
  }
}

// The finished transcript, kept beside the audio it came from.
//
// A 99-minute session was transcribed and then lost: the text sat on screen
// waiting for "Save Session" and the tab went away with the only copy, while
// AssemblyAI had already billed 146 minutes for it. Re-transcribing costs that
// money again, so the text is written here the moment it arrives — before the
// user is asked to do anything.
//
// Only ever an update of the named record: with no held recording there is
// nothing to recover, and a bare transcript record would fool the loader into
// thinking there is audio to offer back.
export async function savePendingTranscript(id, transcript) {
  if (!id || typeof transcript !== 'string' || !transcript.trim()) return false;
  try {
    const db = await openDb();
    const existing = await tx(db, 'readonly', s => s.get(id));
    if (!existing?.blob) { db.close(); return false; }
    await tx(db, 'readwrite', s => s.put({ ...existing, transcript, transcribedAt: Date.now() }, id));
    db.close();
    return true;
  } catch (e) {
    console.warn('[recordingStore] transcript save failed:', e?.message);
    return false;
  }
}

// Transcription came back with no words. Kept on the record so the recovery
// banner can say so, instead of claiming transcription never finished.
export async function markPendingNoSpeech(id) {
  if (!id) return false;
  try {
    const db = await openDb();
    const existing = await tx(db, 'readonly', s => s.get(id));
    if (!existing?.blob) { db.close(); return false; }
    await tx(db, 'readwrite', s => s.put({ ...existing, noSpeech: true, transcribedAt: Date.now() }, id));
    db.close();
    return true;
  } catch (e) {
    console.warn('[recordingStore] no-speech mark failed:', e?.message);
    return false;
  }
}

// Every held recording, newest first.
export async function loadPendingRecordings() {
  try {
    const db = await openDb();
    const pairs = await tx(db, 'readonly', s => {
      const keys = s.getAllKeys();
      const values = s.getAll();
      return () => (keys.result || []).map((k, i) => [k, values.result?.[i]]);
    });
    db.close();
    return assemble(pairs).sort((a, b) => (b.recordedAt ?? 0) - (a.recordedAt ?? 0));
  } catch (e) {
    console.warn('[recordingStore] load failed:', e?.message);
    return [];
  }
}

export async function loadPendingRecording(id) {
  if (!id) return null;
  try {
    const db = await openDb();
    const rec = await tx(db, 'readonly', s => s.get(id));
    if (rec?.live) {
      const pairs = await tx(db, 'readonly', allPairs);
      db.close();
      return assemble(pairs).find(r => r.id === id) ?? null;
    }
    db.close();
    return rec?.blob ? withRecordedAt({ ...rec, id }) : null;
  } catch (e) {
    console.warn('[recordingStore] load failed:', e?.message);
    return null;
  }
}

// Deletes exactly one recording. Without an id it does nothing: "clear the
// pending recording" no longer means anything when there can be several.
export async function clearPendingRecording(id) {
  if (!id) return;
  try {
    const db = await openDb();
    const keys = await tx(db, 'readonly', s => s.getAllKeys());
    await tx(db, 'readwrite', s => {
      s.delete(id);
      for (const k of keys || []) if (isChunkOf(k, id)) s.delete(k);
    });
    db.close();
  } catch (e) {
    console.warn('[recordingStore] clear failed:', e?.message);
  }
}

// ── Live recording ──────────────────────────────────────────────────────────
//
// A header record under the recording's id ({ live: true, … }) and the audio as
// numbered chunk records under "<id>#000001", "<id>#000002", … Appending a
// chunk is one small write; rewriting one growing blob every few seconds would
// copy a 90-minute file over and over. MediaRecorder's timesliced chunks
// concatenate into a playable file, so the chunks in order ARE the recording.

const CHUNK_SEP = '#';
const chunkKey = (id, seq) => `${id}${CHUNK_SEP}${String(seq).padStart(6, '0')}`;
const isChunkOf = (key, id) => typeof key === 'string' && key.startsWith(id + CHUNK_SEP);

function allPairs(s) {
  const keys = s.getAllKeys();
  const values = s.getAll();
  return () => (keys.result || []).map((k, i) => [k, values.result?.[i]]);
}

// Records as the rest of the app sees them: finished recordings as stored, a
// live one as its chunks joined into one blob (and marked interrupted, since a
// live record is only ever read back after its tab went away). Chunk records
// themselves are never listed.
function assemble(pairs) {
  const chunks = new Map();
  for (const [key, val] of pairs) {
    if (val?.chunkOf) {
      if (!chunks.has(val.chunkOf)) chunks.set(val.chunkOf, []);
      chunks.get(val.chunkOf).push([key, val]);
    }
  }
  const out = [];
  for (const [key, rec] of pairs) {
    if (!rec || rec.chunkOf) continue;
    if (rec.live) {
      const parts = (chunks.get(key) || []).sort(([a], [b]) => (a < b ? -1 : 1)).map(([, c]) => c.data);
      if (!parts.length) continue;
      const blob = new Blob(parts, { type: rec.mimeType || 'audio/webm' });
      out.push(withRecordedAt({ ...rec, id: key, blob, interrupted: true }));
    } else if (rec.blob) {
      out.push(withRecordedAt({ ...rec, id: key }));
    }
  }
  return out;
}

// Opens the record a recording will be written into as it happens. Returns
// its id, or null — in which case the recording still works, held in memory
// only, as before.
export async function startLiveRecording({ mimeType, recordedAt }, { now = Date.now } = {}) {
  try {
    const savedAt = now();
    const id = newRecordingId(savedAt);
    const db = await openDb();
    await tx(db, 'readwrite', s => s.put({
      id, live: true, mimeType, seconds: 0, savedAt,
      recordedAt: Number.isFinite(recordedAt) ? recordedAt : savedAt,
    }, id));
    db.close();
    return id;
  } catch (e) {
    console.warn('[recordingStore] live start failed:', e?.message);
    return null;
  }
}

// Writes the next piece of a live recording. seq must increase by call;
// seconds is how much has been recorded so far, for the recovery banner.
export async function appendLiveChunks(id, parts, { seq, seconds, mimeType } = {}) {
  if (!id || !Number.isInteger(seq) || !parts?.length) return false;
  try {
    const data = new Blob(parts, { type: mimeType || parts[0]?.type || 'audio/webm' });
    const db = await openDb();
    const header = await tx(db, 'readonly', s => s.get(id));
    if (!header?.live) { db.close(); return false; }
    await tx(db, 'readwrite', s => {
      s.put({ chunkOf: id, seq, data }, chunkKey(id, seq));
      s.put({ ...header, seconds: Number.isFinite(seconds) ? seconds : header.seconds, savedAt: Date.now() }, id);
    });
    db.close();
    return true;
  } catch (e) {
    console.warn('[recordingStore] live append failed:', e?.message);
    return false;
  }
}

// Recording stopped normally: replace the live record and its chunks with one
// finished record under the same id. Returns the id, or null if it could not
// be written (the caller then falls back to savePendingRecording).
export async function finalizeLiveRecording(id, { blob, mimeType, seconds }) {
  if (!id || !blob) return null;
  try {
    const db = await openDb();
    const header = await tx(db, 'readonly', s => s.get(id));
    const keys = await tx(db, 'readonly', s => s.getAllKeys());
    const savedAt = Date.now();
    await tx(db, 'readwrite', s => {
      s.put({
        id, blob, mimeType, seconds, savedAt,
        recordedAt: Number.isFinite(header?.recordedAt) ? header.recordedAt : savedAt - (seconds || 0) * 1000,
      }, id);
      for (const k of keys || []) if (isChunkOf(k, id)) s.delete(k);
    });
    db.close();
    return id;
  } catch (e) {
    console.warn('[recordingStore] live finalize failed:', e?.message);
    return null;
  }
}
