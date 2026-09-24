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
  savePendingRecording, loadPendingRecording, clearPendingRecording, savePendingTranscript,
} from '../src/lib/recordingStore.js';

// A minimal in-memory stand-in for the one object store this module uses.
function fakeIndexedDb() {
  const data = new Map();
  const store = {
    put: (value, key) => { data.set(key, value); return request(undefined); },
    get: key => request(data.get(key)),
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
  await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 5940 });
  assert.equal((await loadPendingRecording()).transcript, undefined, 'nothing transcribed yet');

  const ok = await savePendingTranscript('[A 0:15] Мне тревожно.');
  assert.equal(ok, true);
  const held = await loadPendingRecording();
  assert.equal(held.transcript, '[A 0:15] Мне тревожно.');
  assert.equal(held.blob, blob, 'the audio must not be disturbed');
  assert.equal(held.seconds, 5940);
  assert.equal(held.mimeType, 'audio/webm');
});

test('a transcript with no held recording is not written as a bare record', async () => {
  fakeIndexedDb();
  assert.equal(await savePendingTranscript('orphan text'), false);
  assert.equal(await loadPendingRecording(), null, 'no audio means nothing to recover');
});

test('an empty transcript is not stored — it would claim the session had no words', async () => {
  fakeIndexedDb();
  await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 60 });
  assert.equal(await savePendingTranscript(''), false);
  assert.equal(await savePendingTranscript('   '), false);
  assert.equal(await savePendingTranscript(null), false);
  assert.equal((await loadPendingRecording()).transcript, undefined);
});

test('saving the session clears audio and transcript together', async () => {
  fakeIndexedDb();
  await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 60 });
  await savePendingTranscript('текст');
  await clearPendingRecording();
  assert.equal(await loadPendingRecording(), null);
});

test('a re-transcription replaces the stored text rather than appending', async () => {
  fakeIndexedDb();
  await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 60 });
  await savePendingTranscript('первый прогон');
  await savePendingTranscript('второй прогон');
  assert.equal((await loadPendingRecording()).transcript, 'второй прогон');
});

test('a storage failure is reported, never thrown at the recording flow', async () => {
  globalThis.indexedDB = { open: () => { throw new Error('blocked'); } };
  assert.equal(await savePendingTranscript('текст'), false);
  assert.equal(await savePendingRecording({ blob, mimeType: 'audio/webm', seconds: 1 }), false);
  assert.equal(await loadPendingRecording(), null);
});
