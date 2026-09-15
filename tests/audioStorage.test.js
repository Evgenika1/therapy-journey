// Audio now travels browser → Supabase Storage → AssemblyAI, never through a
// Vercel function (whose 4.5 MB body limit rejected every recording longer than
// a few minutes). The server only ever receives a path, so whether that path
// belongs to the caller is the one check standing between an account and
// someone else's session audio.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUDIO_BUCKET, AUDIO_URL_TTL_SECONDS, audioPath, isOwnAudioPath, storageContentType,
} from '../src/lib/audioStorage.js';

const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

test('the bucket and link lifetime are fixed', () => {
  assert.equal(AUDIO_BUCKET, 'session-audio');
  // Long enough for AssemblyAI to fetch the file and for one forced-Russian
  // retry to fetch it again; short enough that a leaked link soon dies.
  assert.equal(AUDIO_URL_TTL_SECONDS, 3600);
});

test('a path is the user folder plus a random name with the extension', () => {
  const p = audioPath(USER, 'webm', 'abc-123');
  assert.equal(p, `${USER}/abc-123.webm`);
  const generated = audioPath(USER, 'm4a');
  assert.match(generated, new RegExp(`^${USER}/[0-9a-f-]{36}\\.m4a$`));
  assert.notEqual(audioPath(USER, 'm4a'), generated, 'names must not repeat');
});

test('an unusable extension falls back to bin rather than producing a bad path', () => {
  assert.match(audioPath(USER, '../../etc'), /\.bin$/);
  assert.match(audioPath(USER, ''), /\.bin$/);
  assert.match(audioPath(USER, undefined), /\.bin$/);
});

test('only a path inside the caller\'s own folder is accepted', () => {
  assert.equal(isOwnAudioPath(`${USER}/abc-123.webm`, USER), true);
  assert.equal(isOwnAudioPath(`${OTHER}/abc-123.webm`, USER), false);
});

test('traversal, nesting and malformed paths are rejected', () => {
  for (const bad of [
    `${USER}/../${OTHER}/a.webm`,
    `${USER}/sub/a.webm`,
    `/${USER}/a.webm`,
    `${USER}/`,
    `${USER}`,
    `${USER}x/a.webm`,
    `${USER}/a b.webm`,
    '',
    null,
    undefined,
    42,
  ]) {
    assert.equal(isOwnAudioPath(bad, USER), false, `${JSON.stringify(bad)} must be rejected`);
  }
  assert.equal(isOwnAudioPath(`${USER}/a.webm`, ''), false, 'no user, no path');
  assert.equal(isOwnAudioPath(`${USER}/a.webm`, undefined), false);
});

test('the stored content type drops codec parameters and never comes out empty', () => {
  assert.equal(storageContentType('audio/webm;codecs=opus', 'webm'), 'audio/webm');
  assert.equal(storageContentType('audio/mpeg', 'mp3'), 'audio/mpeg');
  assert.equal(storageContentType('', 'm4a'), 'audio/mp4');
  assert.equal(storageContentType(undefined, 'wav'), 'audio/wav');
  assert.equal(storageContentType('', 'mp4'), 'video/mp4');
  assert.equal(storageContentType('', 'weird'), 'audio/webm');
});
