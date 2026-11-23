-- A trial recording whose transcript was cut at the end of the free minutes
-- keeps its audio, so the whole session can be transcribed once a plan is
-- chosen. The path points into the private session-audio bucket
-- (<user id>/<name>.<ext>); it is cleared, and the audio removed, when the
-- full transcript is made or after 30 days (api/cron/trial-audio).
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS full_audio_path text;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS full_audio_kept_at timestamptz;
