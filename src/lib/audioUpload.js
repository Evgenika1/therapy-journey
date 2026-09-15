// Shared rules for the "import a recording" upload, used by BOTH the browser
// (to reject a file before spending minutes uploading it) and /api/transcribe-file
// (which cannot trust the client). Keep them here so the two never drift apart.

// The common audio/video containers Zoom, voice recorders and phones emit.
export const ALLOWED_EXT = ['mp3', 'm4a', 'wav', 'mp4'];

// The audio is uploaded straight into a Supabase Storage bucket, and the free
// plan caps a single file at 50 MB (the bucket enforces it too — migration 024).
// A live recording is 32 kbit/s, about 14 MB an hour, so a three-hour session
// fits. What does not fit is a long high-bitrate import — an hour of m4a at
// 128 kbit/s is ~58 MB — and the message below says how to shrink it.
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const fmtSize = bytes => bytes >= 1024 ** 3
  ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
  : `${Math.round(bytes / 1024 / 1024)} MB`;

export const extOf = filename => filename.split('.').pop()?.toLowerCase();

// Say the size out loud and, for video, hand over the exact command that fixes
// it — "file too large" alone leaves the user guessing at a 3 GB mp4.
export function tooLargeMessage(bytes, ext) {
  const head = `That file is too large — ${fmtSize(bytes)} (the limit is ${fmtSize(MAX_UPLOAD_BYTES)}).`;
  return ext === 'mp4'
    ? `${head} This looks like video: transcription needs only the audio track, which is tens of times smaller. Extract it and upload again:\nffmpeg -i "source.mp4" -vn -c:a aac -b:a 64k "audio.m4a"`
    : `${head} Compress the recording (mp3 at 64 kbps is plenty for speech) or split it into parts.`;
}

export const unsupportedTypeMessage = ext =>
  `Unsupported format ".${ext}". Allowed: ${ALLOWED_EXT.join(', ')}`;
