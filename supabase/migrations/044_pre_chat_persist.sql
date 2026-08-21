-- ============================================================
-- 044_pre_chat_persist.sql
-- Persist pre-chat flow data on the conversation so the inbox
-- can show what the customer selected + their collected info.
-- ============================================================

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pre_chat_data JSONB DEFAULT '{}'::jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email TEXT;