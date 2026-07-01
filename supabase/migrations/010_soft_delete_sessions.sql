-- Migration 010: Soft delete for sessions
-- Run in Supabase SQL Editor

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

NOTIFY pgrst, 'reload schema';
