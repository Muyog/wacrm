-- ============================================================
-- 042_topics.sql
-- Topics for conversation tracking + dashboard analytics.
-- Idempotent — safe to re-run.
-- ============================================================

-- Global / account-level topic catalog (deduped, normalized labels)
CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#7c3aed',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, label)
);

CREATE INDEX IF NOT EXISTS idx_topics_account ON topics(account_id);

ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can manage topics" ON topics;
CREATE POLICY "Members can manage topics" ON topics FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid() AND profiles.account_id = topics.account_id
    )
  );

-- Junction: which conversations touch a topic
CREATE TABLE IF NOT EXISTS conversation_topics (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (conversation_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_topics_topic ON conversation_topics(topic_id);
CREATE INDEX IF NOT EXISTS idx_conversation_topics_conv ON conversation_topics(conversation_id);