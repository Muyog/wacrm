// ============================================================
// Agent engine — loads an AI agent, resolves provider config
// (agent's own key when present, else account-level ai_configs
// fallback), builds the system prompt, and generates a reply.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import { buildConversationContext } from '@/lib/ai/context'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { latestUserMessage } from '@/lib/ai/query'
import { logAiUsage } from '@/lib/ai/usage'
import { HANDOFF_SENTINEL } from '@/lib/ai/defaults'
import type { AiConfig, ChatMessage, GenerateResult } from '@/lib/ai/types'

export interface AgentRow {
  id: string
  account_id: string | null
  name: string
  description: string | null
  avatar_url: string | null
  system_prompt: string
  model_provider: 'openai' | 'anthropic' | 'gemini'
  model: string
  temperature: number
  max_tokens: number
  tools: string[]
  auto_reply_enabled: boolean
  website_enabled: boolean
  widget_token: string | null
  widget_title: string
  widget_welcome_message: string
  widget_primary_color: string
  widget_position: 'left' | 'right'
  is_active: boolean
  pre_chat_config: Record<string, unknown>
  /** Channel this agent is scoped to. Legacy agents default to 'both'. */
  channel: 'whatsapp' | 'website' | 'both'
  /** WhatsApp-specific agent settings (greeting, response mode, quick replies). */
  wa_config: Record<string, unknown>
}

export const AGENT_COLUMNS =
  'id, account_id, name, description, avatar_url, system_prompt, model_provider, model, temperature, max_tokens, tools, auto_reply_enabled, website_enabled, widget_token, widget_title, widget_welcome_message, widget_primary_color, widget_position, is_active, pre_chat_config, channel, wa_config'

export async function loadAgent(
  db: SupabaseClient,
  agentId: string,
): Promise<AgentRow | null> {
  const { data, error } = await db
    .from('agents')
    .select(AGENT_COLUMNS)
    .eq('id', agentId)
    .maybeSingle()
  if (error) throw error
  return (data as AgentRow | null) ?? null
}

export async function loadAgentByWidgetToken(
  db: SupabaseClient,
  token: string,
): Promise<AgentRow | null> {
  const { data, error } = await db
    .from('agents')
    .select(AGENT_COLUMNS)
    .eq('widget_token', token)
    .maybeSingle()
  if (error) throw error
  return (data as AgentRow | null) ?? null
}

/**
 * Resolve the effective AI config for an agent:
 *  1. Agent's own encrypted key (agent_api_keys) + its provider/model.
 *  2. Account-level ai_configs fallback — used when the agent has
 *     no key of its own (bring-your-own-key at account scope).
 */
export async function resolveAgentConfig(
  db: SupabaseClient,
  agent: AgentRow,
): Promise<{ config: AiConfig; fromAccount: boolean } | null> {
  // Try the agent's own key first.
  if (agent.account_id) {
    const { data: keyRow } = await db
      .from('agent_api_keys')
      .select('api_key, embeddings_api_key')
      .eq('agent_id', agent.id)
      .maybeSingle()

    if (keyRow?.api_key) {
      let apiKey: string
      try {
        apiKey = decrypt(keyRow.api_key)
      } catch {
        apiKey = ''
      }
      if (apiKey) {
        let embeddingsApiKey: string | null = null
        if (keyRow.embeddings_api_key) {
          try {
            embeddingsApiKey = decrypt(keyRow.embeddings_api_key)
          } catch {
            embeddingsApiKey = null
          }
        }
        return {
          fromAccount: false,
          config: {
            provider: agent.model_provider,
            model: agent.model,
            apiKey,
            systemPrompt: agent.system_prompt,
            isActive: agent.is_active,
            autoReplyEnabled: agent.auto_reply_enabled,
            autoReplyMaxPerConversation: 3,
            handoffAgentId: null,
            embeddingsApiKey,
          },
        }
      }
    }
  }

  // Fallback: account-level AI config.
  if (agent.account_id) {
    const accountConfig = await loadAiConfig(db, agent.account_id, {
      requireActive: false,
    })
    if (accountConfig?.apiKey) {
      return {
        fromAccount: true,
        config: {
          ...accountConfig,
          systemPrompt: agent.system_prompt || accountConfig.systemPrompt,
          autoReplyEnabled: agent.auto_reply_enabled,
        },
      }
    }
  }
  return null
}

/**
 * Generate an agent reply for a conversation. Pulls recent context
 * and knowledge base hits (when the KB tool is on), then calls the
 * provider. Used by the website widget channel and WhatsApp.
 */
export async function generateAgentReply(
  db: SupabaseClient,
  agent: AgentRow,
  conversationId: string,
  opts: { accountId?: string | null; mode?: 'auto_reply' | 'draft' } = {},
): Promise<GenerateResult> {
  const resolved = await resolveAgentConfig(db, agent)
  if (!resolved) {
    throw new Error(
      'This agent has no AI provider configured. Add an API key to the agent or to account AI settings.',
    )
  }
  const { config } = resolved
  const mode = opts.mode ?? 'auto_reply'

  const messages = await buildConversationContext(db, conversationId, 20)

  const tools = Array.isArray(agent.tools) ? agent.tools : []
  let kb = ''
  if (tools.some((t) => t === 'knowledge_base')) {
    try {
      const queryText = latestUserMessage(messages)
      const accountId = opts.accountId ?? agent.account_id
      if (accountId && queryText) {
        const hits = await retrieveKnowledge(
          db,
          accountId,
          config,
          queryText,
          5,
        )
        if (hits.length > 0) {
          kb = hits.join('\n\n')
        }
      }
    } catch {
      kb = ''
    }
  }

  // Custom tools (created in the agent editor) are described to the
  // model inline — the model can then reference/claim these
  // capabilities in conversation even before native function-calling
  // is wired for them.
  const customToolLines = tools
    .filter((t) => typeof t === 'object' && t !== null && (t as { type?: string }).type === 'custom')
    .map((t) => `- ${(t as { name: string; description: string }).name}: ${(t as { name: string; description: string }).description}`)

  const systemPrompt = [
    agent.system_prompt || config.systemPrompt || 'You are a helpful assistant.',
    kb ? `\n\nKnowledge base context:\n${kb}` : '',
    customToolLines.length > 0
      ? `\n\nAdditional capabilities you can offer the user (describe honestly; if an action requires data you do not have, say what you need):\n${customToolLines.join('\n')}`
      : '',
    `\n\nCurrent date: ${new Date().toISOString().slice(0, 10)}`,
  ].join('')

  const result = await generateReply({ config, systemPrompt, messages })

  if (result.usage && opts.accountId) {
    try {
      await logAiUsage(db, {
        accountId: opts.accountId,
        conversationId,
        mode,
        provider: config.provider,
        model: config.model,
        usage: result.usage,
      })
    } catch {
      // usage logging must never break the reply
    }
  }
  return result
}

export { HANDOFF_SENTINEL }