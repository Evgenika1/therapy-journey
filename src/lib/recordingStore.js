// Crash-safe holding pen for a recording whose transcription hasn't succeeded yet.
//
// A 91-minute session was lost when the upload to AssemblyAI died: the blob only
// ever lived in a React ref, so the error also ended the recording. Now the blob
// goes to IndexedDB the moment recording stops, and is only deleted once the
// session is actually saved (or explicitly discarded) — a reload, a crash or a
// closed tab no longer costs the user the session.
//
// It stays on the user's own device: this is therapy audio, so it is never
// uploaded anywhere except AssemblyAI for transcription, and it is cleared as
// soon as the transcript is safely saved.

const DB_NAME = 'therapy-journey';
const STORE = 'pending-recording';
const KEY = 'current';

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

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// Every call is best-effort: private windows and blocked site data throw, and a
// failure to cache the blob must never take down the recording flow itself.
export async function savePendingRecording({ blob, mimeType, seconds }) {
  try {
    const db = await openDb();
    await tx(db, 'readwrite', s => s.put({ blob, mimeType, seconds, savedAt: Date.now() }, KEY));
    db.close();
    return true;
  } catch (e) {
    console.warn('[recordingStore] save failed:', e?.message);
    return false;
  }
}

export async function loadPendingRecording() {
  try {
    const db = await openDb();
    const rec = await tx(db, 'readonly', s => s.get(KEY));
    db.close();
    return rec?.blob ? rec : null;
  } catch (e) {
    console.warn('[recordingStore] load failed:', e?.message);
    return null;
  }
}

export async function clearPendingRecording() {
  try {
    const db = await openDb();
    await tx(db, 'readwrite', s => s.delete(KEY));
    db.close();
  } catch (e) {
    console.warn('[recordingStore] clear failed:', e?.message);
  }
}
