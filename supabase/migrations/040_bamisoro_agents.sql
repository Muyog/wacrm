-- ============================================================
-- 040_bamisoro_agents.sql
-- Bamisoro Chat: AI agents, website channel, multi-Meta support
-- Idempotent — safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- AGENTS — the AI agent builder entity (Chatbase/Botpress style)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'New Agent',
  description TEXT,
  avatar_url TEXT,
  -- Behavior
  system_prompt TEXT NOT NULL DEFAULT 'You are a helpful assistant for this business.',
  model_provider TEXT NOT NULL DEFAULT 'openai' CHECK (model_provider IN ('openai', 'anthropic')),
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  temperature NUMERIC(4,2) NOT NULL DEFAULT 0.7,
  max_tokens INTEGER NOT NULL DEFAULT 1024,
  tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Channel: WhatsApp binding (each agent owns numbers via whatsapp_config.agent_id)
  auto_reply_enabled BOOLEAN NOT NULL DEFAULT true,
  -- Channel: Website widget
  website_enabled BOOLEAN NOT NULL DEFAULT false,
  widget_token TEXT UNIQUE,
  widget_title TEXT NOT NULL DEFAULT 'Chat with us',
  widget_welcome_message TEXT NOT NULL DEFAULT 'Hi! How can we help you today?',
  widget_primary_color TEXT NOT NULL DEFAULT '#7c3aed',
  widget_position TEXT NOT NULL DEFAULT 'right' CHECK (widget_position IN ('left', 'right')),
  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_account_id ON agents(account_id);

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can manage agents" ON agents;
CREATE POLICY "Members can manage agents" ON agents FOR ALL
  USING (
    account_id IS NULL
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid() AND profiles.account_id = agents.account_id
    )
  );

-- ------------------------------------------------------------
-- WHATSAPP_CONFIG — allow multiple numbers per account (multi-Meta)
-- Drop UNIQUE(user_id); keep UNIQUE(phone_number_id) so webhook
-- routing by phone_number_id remains unambiguous. Bind each
-- number to an agent (nullable → classic account-level AI).
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_user_id_key' AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config DROP CONSTRAINT whatsapp_config_user_id_key;
  END IF;
END $$;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- CONVERSATIONS — channel + agent attribution + website visitor
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'channel'
  ) THEN
    ALTER TABLE conversations ADD COLUMN channel TEXT NOT NULL DEFAULT 'whatsapp'
      CHECK (channel IN ('whatsapp', 'website'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'agent_id'
  ) THEN
    ALTER TABLE conversations ADD COLUMN agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'visitor_id'
  ) THEN
    ALTER TABLE conversations ADD COLUMN visitor_id TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel);
CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_visitor ON conversations(visitor_id);

-- ------------------------------------------------------------
-- CONTACTS — website visitors have no phone; relax NOT NULL
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'phone' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'channel'
  ) THEN
    ALTER TABLE contacts ADD COLUMN channel TEXT NOT NULL DEFAULT 'whatsapp'
      CHECK (channel IN ('whatsapp', 'website'));
  END IF;
END $$;

-- ------------------------------------------------------------
-- Agent API keys (encrypted, per-agent override — optional)
-- Fallback: account-level ai_configs when agent has no key.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  api_key TEXT NOT NULL,
  embeddings_api_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id)
);

ALTER TABLE agent_api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can manage agent keys" ON agent_api_keys;
CREATE POLICY "Members can manage agent keys" ON agent_api_keys FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM agents WHERE agents.id = agent_api_keys.agent_id
      AND (agents.account_id IS NULL
        OR EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.user_id = auth.uid() AND profiles.account_id = agents.account_id
        ))
    )
  );