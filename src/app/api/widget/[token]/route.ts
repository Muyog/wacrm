import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { loadAgentByWidgetToken, generateAgentReply } from '@/lib/ai/agent'
import { resolveConversationForWidget, insertMessage } from '@/lib/agents/widget'
import { extractAndTagTopics } from '@/lib/agents/topics'

let _admin: any = null
function admin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

/** Public GET — widget boot config (no auth). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params
    if (!token) return NextResponse.json({ error: 'missing token' }, { status: 400 })

    const agent = await loadAgentByWidgetToken(admin(), token)
    if (!agent || !agent.website_enabled) {
      return NextResponse.json({ error: 'widget not found' }, { status: 404 })
    }
    return NextResponse.json({
      agent: {
        name: agent.name,
        avatar_url: agent.avatar_url,
        widget_title: agent.widget_title,
        widget_welcome_message: agent.widget_welcome_message,
        widget_primary_color: agent.widget_primary_color,
        widget_position: agent.widget_position,
        pre_chat: agent.pre_chat_config || {},
      },
    })
  } catch (err) {
    console.error('[widget GET]', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}

/**
 * POST /api/widget/[token] — public chat message. Resolves the
 * visitor conversation, stores the message, runs the agent (when
 * active + configured), stores the reply, returns it.
 * Accepts optional `customer_info` (collected pre-chat form) and
 * `flow_path` (dialog-tree selections) to persist on the thread.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params
    const body = await req.json().catch(() => ({}))
    const text = String(body.message ?? '').trim()
    if (!text) return NextResponse.json({ error: 'message required' }, { status: 400 })

    const agent = await loadAgentByWidgetToken(admin(), token)
    if (!agent || !agent.website_enabled) {
      return NextResponse.json({ error: 'widget not found' }, { status: 404 })
    }
    if (!agent.is_active) {
      return NextResponse.json({ error: 'agent inactive' }, { status: 409 })
    }

    // Merge pre-chat customer info into the contact name if provided
    const customerInfo = body.customer_info || null
    const resolvedName = customerInfo?.name || String(body.name ?? '').trim() || null

    const ctx = await resolveConversationForWidget(
      admin(),
      agent,
      String(body.visitor ?? '').trim(),
      resolvedName,
    )
    if (!ctx) {
      return NextResponse.json({ error: 'could not open conversation' }, { status: 500 })
    }

    // Persist pre-chat flow path + customer info on the conversation
    if (customerInfo || body.flow_path) {
      const meta: Record<string, unknown> = {}
      if (customerInfo) meta.customer_info = customerInfo
      if (body.flow_path) meta.flow_path = body.flow_path
      await admin().from('conversations').update({ pre_chat_data: meta }).eq('id', ctx.conversationId)
      // Also update contact fields if we have them
      if (customerInfo) {
        const contactPatch: Record<string, string> = {}
        if (customerInfo.name) contactPatch.name = customerInfo.name
        if (customerInfo.email) contactPatch.email = customerInfo.email
        if (customerInfo.phone) contactPatch.phone = customerInfo.phone
        if (Object.keys(contactPatch).length) {
          await admin().from('contacts').update(contactPatch).eq('id', ctx.contactId)
        }
      }
    }

    await insertMessage(admin(), ctx.conversationId, 'customer', text)

    // Extract topics from the customer message
    if (agent.account_id) {
      await extractAndTagTopics(admin(), agent.account_id, ctx.conversationId, text)
    }

    let reply = ''
    try {
      const result = await generateAgentReply(
        admin(),
        agent,
        ctx.conversationId,
        { accountId: agent.account_id, mode: 'auto_reply' },
      )
      reply = result.handoff
        ? 'Thanks for reaching out! A member of our team will get back to you shortly.'
        : result.text
    } catch (err) {
      console.error('[widget] generate error:', err)
      reply = ''
    }

    if (reply) {
      await insertMessage(admin(), ctx.conversationId, 'bot', reply)
    }

    return NextResponse.json({ reply, conversation_id: ctx.conversationId })
  } catch (err) {
    console.error('[widget]', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}