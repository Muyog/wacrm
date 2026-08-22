import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { randomUUID } from 'crypto'
import { encrypt } from '@/lib/whatsapp/encryption'

/**
 * GET /api/agents — list the account's AI agents (no keys).
 * POST /api/agents — create a new agent.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ agents: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    await requireRole('admin')

    const body = await req.json().catch(() => ({}))
    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'Agent name is required' }, { status: 400 })
    }
    if (body.system_prompt && body.system_prompt.length > 200000) {
      return NextResponse.json(
        { error: 'System prompt is too long (max 200k chars)' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('agents')
      .insert({
        account_id: accountId,
        name: body.name.trim(),
        description: body.description?.trim() ?? null,
        avatar_url: body.avatar_url ?? null,
        system_prompt:
          body.system_prompt?.trim() ||
          'You are a helpful assistant for this business.',
        model_provider:
          body.model_provider === 'anthropic'
            ? 'anthropic'
            : body.model_provider === 'gemini'
              ? 'gemini'
              : 'openai',
        model: body.model || (body.model_provider === 'anthropic' ? 'claude-sonnet-4-6' : body.model_provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini'),
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
        max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : 1024,
        tools: Array.isArray(body.tools) ? body.tools : [],
        auto_reply_enabled: body.auto_reply_enabled !== false,
        website_enabled: !!body.website_enabled,
        widget_token: body.generate_widget ? randomUUID() : null,
        widget_title: body.widget_title?.trim() || 'Chat with us',
        widget_welcome_message:
          body.widget_welcome_message?.trim() || 'Hi! How can we help you today?',
        widget_primary_color: body.widget_primary_color || '#7c3aed',
        widget_position: body.widget_position === 'left' ? 'left' : 'right',
        is_active: body.is_active !== false,
        pre_chat_config: body.pre_chat_config || {},
        channel:
          body.channel === 'whatsapp' || body.channel === 'website'
            ? body.channel
            : 'both',
        wa_config:
          body.wa_config && typeof body.wa_config === 'object'
            ? body.wa_config
            : {},
      })
      .select()
      .single()
    if (error) throw error

    // Optional per-agent API key (encrypted at rest).
    if (body.api_key?.trim()) {
      const { error: keyErr } = await supabase.from('agent_api_keys').insert({
        agent_id: data.id,
        api_key: encrypt(body.api_key.trim()),
        embeddings_api_key:
          body.embeddings_api_key?.trim()
            ? encrypt(body.embeddings_api_key.trim())
            : null,
      })
      if (keyErr) {
        console.error('[agents POST] key insert failed:', keyErr)
      }
    }

    return NextResponse.json({ agent: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}