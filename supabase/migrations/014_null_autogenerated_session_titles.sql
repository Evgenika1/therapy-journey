-- Migration 014: null out auto-generated "Session M/D/YYYY" titles.
--
-- Untitled sessions used to bake `Session ${new Date().toLocaleDateString()}`
-- into the title at save time, using the BROWSER clock — so a wrong local clock
-- produced a wrong stored date (e.g. a July 29 recording titled "Session
-- 7/24/2026"). The app now stores NULL for untitled sessions and derives the
-- display name from created_at (the correct DB timestamp) instead. This nulls
-- the already-saved date titles so they re-derive the same way.
--
-- Only auto-generated "Session <date>" titles are matched; user-typed titles
-- are left untouched. Run in the Supabase SQL editor.

UPDATE public.sessions
SET title = NULL
WHERE title ~ '^Session \d{1,2}[./]\d{1,2}[./]\d{4}$';

NOTIFY pgrst, 'reload schema';
