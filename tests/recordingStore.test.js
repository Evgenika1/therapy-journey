// The holding pen keeps the audio AND, once it exists, the transcript.
//
// A 99-minute session was transcribed successfully — AssemblyAI billed 146
// minutes for it — and then lost: the text sat on screen waiting for "Save
// Session", the tab went away, and the only copy went with it. The audio
// survived in IndexedDB, but re-transcribing it costs the money again, so the
// text now goes into the same record the moment it arrives.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  savePendingRecording, loadPendingRecording, loadPendingRecordings, clearPendingRecording,
  savePendingTranscript, LEGACY_KEY,
} from '../src/lib/recordingStore.js';

// A minimal in-memory stand-in for the one object store this module uses.
function fakeIndexedDb() {
  const data = new Map();
  const store = {
    put: (value, key) => { data.set(key, value); return request(undefined); },
    get: key => request(data.get(key)),
    getAll: () => request([...data.values()]),
    getAllKeys: () => request([...data.keys()]),
    delete: key => { data.delete(key); return request(undefined); },
  };
  function request(result) {
    const req = { result };
    queueMicrotask(() => req.onsuccess?.({ target: req }));
    return req;
  }
  globalThis.indexedDB = {
    open: () => {
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => store,
        transaction: () => {
          const t = { objectStore: () => store, oncomplete: null, onerror: null };
          queueMicrotask(() => t.oncomplete?.());
          return t;
        },
        close: () => {},
      };
      return request(db);
    },
  };
  return data;
}

const blob = { size: 1234 };

test('the transcript is stored alongside the audio it came from', async () => {
  fakeIndexedDb();
  const id = await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 5940 });
  assert.ok(id, 'holding a recording returns its id');
  assert.equal((await loadPendingRecording(id)).transcript, undefined, 'nothing transcribed yet');

  const ok = await savePendingTranscript(id, '[A 0:15] Мне тревожно.');
  assert.equal(ok, true);
  const held = await loadPendingRecording(id);
  assert.equal(held.transcript, '[A 0:15] Мне тревожно.');
  assert.equal(held.blob, blob, 'the audio must not be disturbed');
  assert.equal(held.seconds, 5940);
  assert.equal(held.mimeType, 'audio/webm');
});

test('a new recording never overwrites one that is still waiting to be saved', async () => {
  fakeIndexedDb();
  const long = { size: 90_000_000 };
  const first = await savePendingRecording({ blob: long, mimeType: 'audio/webm', seconds: 5603 }, { now: () => 1_000_000 });
  await savePendingTranscript(first, 'девяносто три минуты');
  const second = await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 4 }, { now: () => 2_000_000 });

  assert.notEqual(first, second);
  const all = await loadPendingRecordings();
  assert.equal(all.length, 2, 'both recordings are held');
  assert.deepEqual(all.map(r => r.id), [second, first], 'newest first');
  assert.equal(all[1].blob, long);
  assert.equal(all[1].transcript, 'девяносто три минуты', 'the older one keeps its transcript');
});

test('a transcript goes to its own recording only', async () => {
  fakeIndexedDb();
  const a = await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 60 });
  const b = await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 30 });
  await savePendingTranscript(b, 'второй');
  assert.equal((await loadPendingRecording(a)).transcript, undefined);
  assert.equal((await loadPendingRecording(b)).transcript, 'второй');
});

test('saving one session clears that recording and leaves the others', async () => {
  fakeIndexedDb();
  const a = await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 60 });
  const b = await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 30 });
  await savePendingTranscript(a, 'текст');
  await clearPendingRecording(a);
  assert.equal(await loadPendingRecording(a), null);
  assert.deepEqual((await loadPendingRecordings()).map(r => r.id), [b]);
});

test('clearing without an id deletes nothing', async () => {
  fakeIndexedDb();
  const a = await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 60 });
  await clearPendingRecording();
  await clearPendingRecording(undefined);
  assert.ok(await loadPendingRecording(a));
});

test('a recording held by the old single-slot version is still offered back, with its date', async () => {
  const data = fakeIndexedDb();
  const savedAt = Date.UTC(2026, 10, 11, 10, 30);
  data.set(LEGACY_KEY, { blob, mimeType: 'audio/webm', seconds: 5603, savedAt, transcript: 'старая запись' });
  const newer = await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 4 });

  const all = await loadPendingRecordings();
  assert.equal(all.length, 2, 'the new recording does not replace the old slot');
  const legacy = all.find(r => r.id === LEGACY_KEY);
  assert.equal(legacy.transcript, 'старая запись');
  assert.equal(legacy.recordedAt, savedAt - 5603 * 1000, 'recorded at = stopped at minus its length');
  assert.ok(all.some(r => r.id === newer));
});

test('a recording knows when it was made', async () => {
  fakeIndexedDb();
  const id = await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 600 }, { now: () => 5_000_000 });
  assert.equal((await loadPendingRecording(id)).recordedAt, 5_000_000 - 600_000);
  const explicit = await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 600, recordedAt: 42 });
  assert.equal((await loadPendingRecording(explicit)).recordedAt, 42);
});

test('a transcript with no held recording is not written as a bare record', async () => {
  fakeIndexedDb();
  assert.equal(await savePendingTranscript('rec-missing', 'orphan text'), false);
  assert.equal(await savePendingTranscript(null, 'orphan text'), false);
  assert.deepEqual(await loadPendingRecordings(), [], 'no audio means nothing to recover');
});

test('an empty transcript is not stored — it would claim the session had no words', async () => {
  fakeIndexedDb();
  const id = await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 60 });
  assert.equal(await savePendingTranscript(id, ''), false);
  assert.equal(await savePendingTranscript(id, '   '), false);
  assert.equal(await savePendingTranscript(id, null), false);
  assert.equal((await loadPendingRecording(id)).transcript, undefined);
});

test('a re-transcription replaces the stored text rather than appending', async () => {
  fakeIndexedDb();
  const id = await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 60 });
  await savePendingTranscript(id, 'первый прогон');
  await savePendingTranscript(id, 'второй прогон');
  assert.equal((await loadPendingRecording(id)).transcript, 'второй прогон');
});

test('a storage failure is reported, never thrown at the recording flow', async () => {
  globalThis.indexedDB = { open: () => { throw new Error('blocked'); } };
  assert.equal(await savePendingTranscript('rec-1', 'текст'), false);
  assert.equal(await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 1 }), null);
  assert.equal(await loadPendingRecording('rec-1'), null);
  assert.deepEqual(await loadPendingRecordings(), []);
});
