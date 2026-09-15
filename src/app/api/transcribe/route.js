import { startJobFromStorage } from '@/lib/transcribeFromStorage';

// POST { path } — start transcribing a live recording the browser has already
// uploaded to Supabase Storage. The audio used to be the request body, which a
// Vercel function refuses above 4.5 MB; see src/lib/transcribeFromStorage.js.
// The client then polls /api/transcribe/status.
export const maxDuration = 60;

export async function POST(req) {
  return startJobFromStorage(req, { tag: 'transcribe' });
}
