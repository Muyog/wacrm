-- ============================================================
-- 046_channel_scoped_agents.sql
-- Agent creation overhaul: channel-scoped agents.
--   agents.channel   — 'whatsapp' | 'website' | 'both' (legacy)
--   agents.wa_config — WhatsApp-specific agent settings (greeting,
--                      response mode, quick replies, attached flows)
--   flows.agent_id   — bind a flow to a WhatsApp agent so the agent
--                      builder can attach/detach flows per agent.
-- Idempotent — safe to re-run.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'channel'
  ) THEN
    ALTER TABLE agents ADD COLUMN channel TEXT NOT NULL DEFAULT 'both'
      CHECK (channel IN ('whatsapp', 'website', 'both'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'wa_config'
  ) THEN
    ALTER TABLE agents ADD COLUMN wa_config JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Attach flows to agents (nullable → unassigned flow works for every
-- WhatsApp number exactly as before).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'flows' AND column_name = 'agent_id'
  ) THEN
    ALTER TABLE flows ADD COLUMN agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_flows_agent_id ON flows(agent_id);
