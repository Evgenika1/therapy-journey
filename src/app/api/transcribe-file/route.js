import { startJobFromStorage } from '@/lib/transcribeFromStorage';
import { ALLOWED_EXT } from '@/lib/audioUpload';

// POST { path, filename } — start transcribing an imported recording the browser
// has already uploaded to Supabase Storage. Same flow as /api/transcribe, with
// the imported file's extension checked against the allowed formats. The client
// then polls /api/transcribe/status.
export const maxDuration = 60;

export async function POST(req) {
  return startJobFromStorage(req, { tag: 'transcribe-file', allowedExt: ALLOWED_EXT });
}
