import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { randomUUID } from 'crypto'

/**
 * GET /api/agents/[id] — one agent (no keys; has_key flag only).
 * PATCH /api/agents/[id] — update agent + optional key.
 * DELETE /api/agents/[id] — delete agent.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const { data: keyRow } = await supabase
      .from('agent_api_keys')
      .select('api_key, embeddings_api_key')
      .eq('agent_id', id)
      .maybeSingle()

    const { api_key, ...safe } = data
    void api_key
    return NextResponse.json({ agent: safe, has_key: !!keyRow?.api_key })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId } = await getCurrentAccount()
    await requireRole('admin')

    const body = await req.json().catch(() => ({}))
    const allowed = [
      'name',
      'description',
      'avatar_url',
      'system_prompt',
      'model_provider',
      'model',
      'temperature',
      'max_tokens',
      'tools',
      'auto_reply_enabled',
      'website_enabled',
      'widget_title',
      'widget_welcome_message',
      'widget_primary_color',
      'widget_position',
      'is_active',
    ]
    const patch: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) patch[key] = body[key]
    }
    if (body.generate_widget && !body.widget_token) {
      patch.widget_token = randomUUID()
    }
    if (patch.name !== undefined && !String(patch.name).trim()) {
      return NextResponse.json({ error: 'Agent name is required' }, { status: 400 })
    }

    // Verify ownership before patch.
    const { data: existing } = await supabase
      .from('agents')
      .select('id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const { data, error } = await supabase
      .from('agents')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error

    // Optional per-agent key upsert.
    if (body.api_key?.trim() || body.embeddings_api_key !== undefined || body.clear_key) {
      const current = await supabase
        .from('agent_api_keys')
        .select('id')
        .eq('agent_id', id)
        .maybeSingle()
      const keyData: Record<string, unknown> = {}
      if (body.api_key?.trim()) keyData.api_key = encrypt(body.api_key.trim())
      if (body.embeddings_api_key?.trim()) {
        keyData.embeddings_api_key = encrypt(body.embeddings_api_key.trim())
      }
      if (body.clear_key) keyData.api_key = encrypt('') // unset
      if (current.data?.id) {
        await supabase.from('agent_api_keys').update(keyData).eq('agent_id', id)
      } else if (Object.keys(keyData).length > 0 && keyData.api_key) {
        await supabase.from('agent_api_keys').insert({
          agent_id: id,
          api_key: String(keyData.api_key),
          embeddings_api_key: keyData.embeddings_api_key ? String(keyData.embeddings_api_key) : null,
        })
      }
    }

    return NextResponse.json({ agent: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId } = await getCurrentAccount()
    await requireRole('admin')
    const { error } = await supabase
      .from('agents')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}