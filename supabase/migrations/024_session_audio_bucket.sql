-- Migration 024: a private bucket where session audio waits while it is
-- transcribed.
--
-- Recordings used to be POSTed through our own API route to AssemblyAI. On
-- Vercel a function refuses any request body over 4.5 MB, so every recording
-- longer than a few minutes failed with FUNCTION_PAYLOAD_TOO_LARGE. The browser
-- now uploads straight into this bucket, the server gives AssemblyAI a one-hour
-- signed link, and the file is deleted as soon as the transcription settles.
--
-- Private, 50 MB per file (the free plan's ceiling; a 32 kbit/s recording is
-- about 14 MB an hour), audio plus mp4 imports only. Each user can write, read
-- and delete only inside a folder named after their own id — the app puts files
-- at `<user id>/<random>.<ext>`.
--
-- Additive: nothing existing reads this bucket, so the site keeps working
-- before and after it runs. Run in the Supabase SQL editor.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('session-audio', 'session-audio', false, 52428800, ARRAY['audio/*', 'video/mp4'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "session audio: upload to own folder" ON storage.objects;
CREATE POLICY "session audio: upload to own folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'session-audio' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Needed to create the signed link AssemblyAI downloads from.
DROP POLICY IF EXISTS "session audio: read own folder" ON storage.objects;
CREATE POLICY "session audio: read own folder" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'session-audio' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "session audio: delete own folder" ON storage.objects;
CREATE POLICY "session audio: delete own folder" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'session-audio' AND (storage.foldername(name))[1] = auth.uid()::text);
