// Shared rules for the "import a recording" upload, used by BOTH the browser
// (to reject a file before spending minutes uploading it) and /api/transcribe-file
// (which cannot trust the client). Keep them here so the two never drift apart.

// The common audio/video containers Zoom, voice recorders and phones emit.
export const ALLOWED_EXT = ['mp3', 'm4a', 'wav', 'mp4'];

// Node cannot write a request body larger than ~2 GiB to a socket: the write()
// syscall fails with EINVAL and fetch reports only "fetch failed", with the real
// reason buried in err.cause. Measured on Node 24: 1.5 GiB sends fine, 2 GiB - 1
// already throws. So the hard ceiling here is the runtime's, not AssemblyAI's.
//
// We cap well below it. 500 MB is many hours of any compressed format; what
// actually blows past it is a video container — an mp4 of a one-hour call is
// gigabytes of H.264 wrapping ~50 MB of AAC, and only the audio matters here.
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export const fmtSize = bytes => bytes >= 1024 ** 3
  ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
  : `${Math.round(bytes / 1024 / 1024)} MB`;

export const extOf = filename => filename.split('.').pop()?.toLowerCase();

// Say the size out loud and, for video, hand over the exact command that fixes
// it — "file too large" alone leaves the user guessing at a 3 GB mp4.
export function tooLargeMessage(bytes, ext) {
  const head = `That file is too large — ${fmtSize(bytes)} (the limit is ${fmtSize(MAX_UPLOAD_BYTES)}).`;
  return ext === 'mp4'
    ? `${head} This looks like video: transcription needs only the audio track, which is tens of times smaller. Extract it and upload again:\nffmpeg -i "source.mp4" -vn -c:a aac -b:a 128k "audio.m4a"`
    : `${head} Compress the recording (mp3 at 128 kbps, say) or split it into parts.`;
}

export const unsupportedTypeMessage = ext =>
  `Unsupported format ".${ext}". Allowed: ${ALLOWED_EXT.join(', ')}`;
