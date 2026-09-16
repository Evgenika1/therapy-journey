// Where session audio waits while it is transcribed.
//
// The audio used to be POSTed through our own API route and forwarded to
// AssemblyAI from there. On Vercel a function request body is capped at 4.5 MB,
// so every recording longer than a few minutes was rejected with
// FUNCTION_PAYLOAD_TOO_LARGE before our code ever ran. Now the browser uploads
// straight into a private Supabase Storage bucket (EU region, same as the
// database), the server hands AssemblyAI a short-lived signed link, and the file
// is deleted as soon as the transcription settles. Nothing but a path goes
// through a function.
//
// Pure functions: no network, no Supabase client.

export const AUDIO_BUCKET = 'session-audio';

// Long enough for AssemblyAI to fetch the file, and fetch it again for the
// forced-Russian retry; short enough that a leaked link soon stops working.
export const AUDIO_URL_TTL_SECONDS = 3600;

const EXT_RE = /^[a-z0-9]{1,5}$/;

const newId = () => (globalThis.crypto?.randomUUID?.()
  ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

// `<user id>/<random>.<ext>`. The first folder is what the bucket's RLS policies
// match against auth.uid(), so a user can only write, read or delete there.
export function audioPath(userId, ext, id = newId()) {
  const e = typeof ext === 'string' && EXT_RE.test(ext.toLowerCase()) ? ext.toLowerCase() : 'bin';
  return `${userId}/${id}.${e}`;
}

// The server trusts nothing about a path it is sent: exactly one folder, which
// must be the caller's, and a plain file name inside it.
export function isOwnAudioPath(path, userId) {
  if (typeof path !== 'string' || typeof userId !== 'string' || !userId) return false;
  const slash = path.indexOf('/');
  if (slash === -1 || path.slice(0, slash) !== userId) return false;
  const name = path.slice(slash + 1);
  return /^[A-Za-z0-9_-]+\.[a-z0-9]{1,5}$/.test(name);
}

const BY_EXT = { webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4' };

// The bucket only accepts audio/* and video/mp4. MediaRecorder reports
// "audio/webm;codecs=opus", and a picked file can report nothing at all, so the
// type is cut to its base and filled in from the extension when missing.
export function storageContentType(mimeType, ext) {
  const base = typeof mimeType === 'string' ? mimeType.split(';')[0].trim().toLowerCase() : '';
  if (base) return base;
  return BY_EXT[typeof ext === 'string' ? ext.toLowerCase() : ''] || 'audio/webm';
}

// ── resumable upload ─────────────────────────────────────────────────────────
//
// A 24 MB recording is minutes of upload, and one dropped connection used to
// lose all of it: the single POST failed and the user saw "Transcription
// failed" with the audio still held in the browser. Supabase Storage speaks the
// resumable (tus) protocol, so a drop costs one chunk, and the client retries
// on its own.

// Supabase requires exactly this chunk size on its resumable endpoint; any
// other value is rejected.
export const RESUMABLE_CHUNK_BYTES = 6 * 1024 * 1024;

// Four retries over roughly half a minute: long enough to ride out a lift, a
// tunnel or a wifi handover, short enough that a real outage still ends with an
// error the user can act on rather than a spinner that never resolves.
export const RESUMABLE_RETRY_DELAYS = [1000, 3000, 8000, 20000];

export function resumableUploadOptions({ supabaseUrl, accessToken, anonKey, path, contentType }) {
  return {
    endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
    retryDelays: RESUMABLE_RETRY_DELAYS,
    headers: {
      authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      // Never overwrite: every recording gets its own random name, so a
      // collision would mean something is wrong, not something to silently fix.
      'x-upsert': 'false',
    },
    // Supabase reads the destination from the upload metadata rather than the URL.
    metadata: { bucketName: AUDIO_BUCKET, objectName: path, contentType, cacheControl: '3600' },
    chunkSize: RESUMABLE_CHUNK_BYTES,
    uploadDataDuringCreation: true,
    // The fingerprint is what allows a resume; once the file is up it is litter.
    removeFingerprintOnSuccess: true,
  };
}

// Whole percent, clamped — tus reports byte counts that can round past the
// total, and a progress bar showing 101% reads as a bug.
export function uploadPercent(bytesSent, bytesTotal) {
  if (!Number.isFinite(bytesSent) || !Number.isFinite(bytesTotal) || bytesTotal <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((bytesSent / bytesTotal) * 100)));
}
