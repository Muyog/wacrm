-- ============================================================
-- 041_gemini_provider.sql
-- Add 'gemini' as a supported AI provider everywhere.
-- Idempotent — safe to re-run.
-- ============================================================

-- agents.model_provider
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT c.conname INTO con_name
  FROM pg_constraint c
  WHERE c.conrelid = 'agents'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%model_provider%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE agents DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE agents
  ADD CONSTRAINT agents_model_provider_check
  CHECK (model_provider IN ('openai', 'anthropic', 'gemini'));

-- ai_configs.provider
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT c.conname INTO con_name
  FROM pg_constraint c
  WHERE c.conrelid = 'ai_configs'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%provider%'
    AND pg_get_constraintdef(c.oid) NOT LIKE '%gemini%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ai_configs DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'gemini'));

-- ai_usage_log.provider
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT c.conname INTO con_name
  FROM pg_constraint c
  WHERE c.conrelid = 'ai_usage_log'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%provider%'
    AND pg_get_constraintdef(c.oid) NOT LIKE '%gemini%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE ai_usage_log DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'gemini'));