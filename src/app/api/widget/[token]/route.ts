import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { loadAgentByWidgetToken, generateAgentReply } from '@/lib/ai/agent'
import { resolveConversationForWidget, insertMessage } from '@/lib/agents/widget'
import { extractAndTagTopics } from '@/lib/agents/topics'

// Lazy admin client (service role) — public widget endpoints must not
// depend on a user session.
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
 * The visitor payload uses a stable client-generated id so returning
 * visitors continue the same thread in the inbox.
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

    const ctx = await resolveConversationForWidget(
      admin(),
      agent,
      String(body.visitor ?? '').trim(),
      String(body.name ?? '').trim() || null,
    )
    if (!ctx) {
      return NextResponse.json({ error: 'could not open conversation' }, { status: 500 })
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