// Noticing that the deployed app has moved on since this tab loaded.
//
// A tab open across a deploy keeps running the JavaScript it loaded. That cost a
// 111-minute recording its upload: the page was still POSTing audio through the
// API route long after that path had been replaced by a direct upload, so the
// upload died on Vercel's 4.5 MB body limit and the user saw only
// "Transcription failed".
//
// The app never reloads by itself — a reload mid-recording would cut a session
// in half. It offers, and the person picks the moment.

// How often a tab asks. Long recordings run for hours, so a deploy during one
// must be noticed without polling every few seconds for nothing.
export const VERSION_CHECK_MS = 5 * 60 * 1000;

// What /api/version answers when there is no deployment behind it — local
// development, where the dev server recompiles in place and a banner would be
// permanent noise.
export const DEV_VERSION = 'dev';

export function shouldOfferReload({ loaded, latest } = {}) {
  if (typeof loaded !== 'string' || typeof latest !== 'string') return false;
  if (!loaded || !latest) return false;
  if (loaded === DEV_VERSION || latest === DEV_VERSION) return false;
  return loaded !== latest;
}
