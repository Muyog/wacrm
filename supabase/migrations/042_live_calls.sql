-- ============================================================
-- 042_live_calls.sql
-- Bamisoro Call Intelligence: live call transcription + events
-- Idempotent — safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- live_calls — one row per live (or completed) monitored call
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS live_calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID,                          -- wacrm account (nullable for now)
  session_id TEXT UNIQUE NOT NULL,          -- agent-generated id (e.g. msi-<ts>)
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound','outbound','internal')),
  caller_number TEXT,
  caller_name TEXT,
  agent_name TEXT DEFAULT 'Muyiwa Ogundiya',
  extension TEXT,
  ddi TEXT,
  status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','active','on_hold','ended','failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER DEFAULT 0,
  -- AI-derived
  intent TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive','neutral','negative','frustrated')),
  sentiment_score NUMERIC(3,2),
  summary TEXT,
  ai_insights INTEGER DEFAULT 0,            -- count of insights/actions raised
  recording_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_calls_status ON live_calls(status);
CREATE INDEX IF NOT EXISTS idx_live_calls_started ON live_calls(started_at DESC);

-- ------------------------------------------------------------
-- live_call_messages — streaming transcript + tool events
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS live_call_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id UUID NOT NULL REFERENCES live_calls(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,                     -- ordering within the call
  role TEXT NOT NULL CHECK (role IN ('caller','agent','ai','system','tool')),
  text TEXT NOT NULL,
  is_final BOOLEAN NOT NULL DEFAULT true,   -- false while mid-utterance
  tool_name TEXT,                           -- for role='tool'
  tool_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_call_messages_call ON live_call_messages(call_id, seq);

-- ------------------------------------------------------------
-- live_call_tools — structured record of function calls made mid-call
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS live_call_tools (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id UUID NOT NULL REFERENCES live_calls(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  arguments JSONB,
  result JSONB,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error','pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_live_calls_updated ON live_calls;
CREATE TRIGGER trg_live_calls_updated
  BEFORE UPDATE ON live_calls
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- REALTIME: enable change feeds on these tables
-- ------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE live_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE live_call_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE live_call_tools;

-- Full row images so clients receive payloads without a second fetch
ALTER TABLE live_calls REPLICA IDENTITY FULL;
ALTER TABLE live_call_messages REPLICA IDENTITY FULL;
ALTER TABLE live_call_tools REPLICA IDENTITY FULL;

-- ------------------------------------------------------------
-- RLS: anon can read (dashboard uses anon key); writes via service key only
-- ------------------------------------------------------------
ALTER TABLE live_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_call_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_call_tools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read live_calls" ON live_calls;
CREATE POLICY "anon read live_calls" ON live_calls FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon read messages" ON live_call_messages;
CREATE POLICY "anon read messages" ON live_call_messages FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon read tools" ON live_call_tools;
CREATE POLICY "anon read tools" ON live_call_tools FOR SELECT TO anon USING (true);
