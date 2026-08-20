// ============================================================
// Bamisoro Chat Intelligence — config store.
//
// The bot (Nola) is configured entirely from wacrm so the human team
// can edit its system prompt, model and tools from the wacrm UI,
// without touching Vercel env vars. We store the bot config in the
// existing `agents` table columns (system_prompt / model / temperature
// / tools) — no DDL migration required. A dedicated "Bamisoro Chat
// Intelligence" agent row is the single source of truth.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Single stable name identifying the Bamisoro Chat Intelligence agent. */
export const BAMISORO_CHAT_AGENT_NAME = 'Bamisoro Chat Intelligence';

export interface BamisoroTool {
  name: string;
  description: string;
}

export interface BamisoroChatConfig {
  system_prompt: string;
  model: string;
  temperature: number;
  /** Free-form tool descriptors the bot understands (e.g. log_complaint). */
  tools: BamisoroTool[];
  /** Forward-compatible knobs. button_delimiter is fixed at "|||". */
  meta: { button_delimiter: string };
  updated_at?: string;
}

export const DEFAULT_BAMISORO_CHAT_CONFIG: BamisoroChatConfig = {
  system_prompt:
    'You are Nola, the Bamisoro Chat Intelligence assistant for Wema Bank / ALAT. ' +
    'Be warm, concise, and accurate. Help customers with loans, accounts, cards, ' +
    'and support. Use the provided tools to log complaints and check ticket status.',
  model: 'gemini-2.5-flash',
  temperature: 0.4,
  tools: [
    { name: 'log_complaint', description: 'Log a support ticket for the customer.' },
    { name: 'check_ticket_status', description: 'Check an existing ticket status.' },
    { name: 'escalate_ticket', description: 'Escalate a ticket to urgent.' },
    { name: 'trigger_flow', description: 'Trigger a WhatsApp form flow.' },
  ],
  meta: { button_delimiter: '|||' },
};

/** Find the Bamisoro Chat Intelligence agent row for an account. */
export async function findBamisoroAgent(
  db: SupabaseClient,
  accountId: string,
): Promise<{ id: string; config: BamisoroChatConfig } | null> {
  const { data, error } = await db
    .from('agents')
    .select('id, system_prompt, model, temperature, tools, updated_at')
    .eq('account_id', accountId)
    .eq('name', BAMISORO_CHAT_AGENT_NAME)
    .maybeSingle();
  if (error) {
    console.error('[bamisoro-chat] agent lookup error:', error);
    return null;
  }
  if (!data) return null;
  const row = data as {
    id: string;
    system_prompt?: string;
    model?: string;
    temperature?: number;
    tools?: unknown;
    updated_at?: string;
  };
  const config: BamisoroChatConfig = {
    system_prompt: row.system_prompt ?? DEFAULT_BAMISORO_CHAT_CONFIG.system_prompt,
    model: row.model ?? DEFAULT_BAMISORO_CHAT_CONFIG.model,
    temperature: typeof row.temperature === 'number' ? row.temperature : DEFAULT_BAMISORO_CHAT_CONFIG.temperature,
    tools: Array.isArray(row.tools)
      ? (row.tools as BamisoroTool[])
      : DEFAULT_BAMISORO_CHAT_CONFIG.tools,
    meta: { button_delimiter: '|||' },
    updated_at: row.updated_at,
  };
  return { id: row.id, config };
}

/** Ensure the Bamisoro Chat Intelligence agent exists; create with defaults if not. */
export async function ensureBamisoroAgent(
  db: SupabaseClient,
  accountId: string,
): Promise<{ id: string; config: BamisoroChatConfig }> {
  const existing = await findBamisoroAgent(db, accountId);
  if (existing) return existing;

  const { data, error } = await db
    .from('agents')
    .insert({
      account_id: accountId,
      name: BAMISORO_CHAT_AGENT_NAME,
      description: 'Wema/ALAT WhatsApp assistant (Nola) — configured from wacrm.',
      system_prompt: DEFAULT_BAMISORO_CHAT_CONFIG.system_prompt,
      model: DEFAULT_BAMISORO_CHAT_CONFIG.model,
      temperature: DEFAULT_BAMISORO_CHAT_CONFIG.temperature,
      tools: DEFAULT_BAMISORO_CHAT_CONFIG.tools,
      auto_reply_enabled: false,
      is_active: true,
      widget_primary_color: '#7c3aed',
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`Failed to create Bamisoro agent: ${JSON.stringify(error)}`);
  }
  return { id: data.id, config: DEFAULT_BAMISORO_CHAT_CONFIG };
}

/** Persist edited config to the native agent columns. */
export async function saveBamisoroConfig(
  db: SupabaseClient,
  agentId: string,
  config: BamisoroChatConfig,
): Promise<void> {
  const { error } = await db
    .from('agents')
    .update({
      system_prompt: config.system_prompt,
      model: config.model,
      temperature: config.temperature,
      tools: config.tools,
      updated_at: new Date().toISOString(),
    })
    .eq('id', agentId);
  if (error) throw new Error(`Failed to save Bamisoro config: ${JSON.stringify(error)}`);
}
