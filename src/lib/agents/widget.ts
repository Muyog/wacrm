// ============================================================
// Widget channel helpers — website conversations routed into the
// account's inbox. Uses account owner's user_id for the NOT NULL
// audit column (same convention as resolve-conversation.ts).
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentRow } from '@/lib/ai/agent'

/**
 * Resolve (or create) a website conversation for a visitor.
 * A visitor is identified by a client-generated id stored in the
 * widget's localStorage, so returning visitors continue their thread.
 */
export async function resolveConversationForWidget(
  db: SupabaseClient,
  agent: AgentRow,
  visitorId: string,
  name?: string | null,
): Promise<{ conversationId: string; contactId: string } | null> {
  if (!agent.account_id || !agent.id) return null

  // Owner user id — audit column convention (NOT NULL user_id).
  const { data: account } = await db
    .from('accounts')
    .select('owner_user_id')
    .eq('id', agent.account_id)
    .maybeSingle()
  const ownerUserId = account?.owner_user_id as string | undefined
  if (!ownerUserId) return null

  const visitor = visitorId || 'anon-' + Math.random().toString(36).slice(2)

  // Reuse an open conversation for the same visitor + agent.
  const { data: existing } = await db
    .from('conversations')
    .select('id, contact_id, status')
    .eq('account_id', agent.account_id)
    .eq('agent_id', agent.id)
    .eq('visitor_id', visitor)
    .eq('channel', 'website')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.id) {
    if (existing.status === 'closed') {
      await db.from('conversations').update({ status: 'open' }).eq('id', existing.id)
    }
    return { conversationId: existing.id, contactId: existing.contact_id }
  }

  // Create contact (no phone for website visitors) + conversation.
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .insert({
      user_id: ownerUserId,
      account_id: agent.account_id,
      name: name?.trim() || 'Website visitor',
      phone: null,
      channel: 'website',
    })
    .select('id')
    .single()
  if (contactErr || !contact?.id) {
    console.error('[widget] contact create error:', contactErr)
    return null
  }

  const { data: conversation, error: convErr } = await db
    .from('conversations')
    .insert({
      user_id: ownerUserId,
      account_id: agent.account_id,
      contact_id: contact.id,
      channel: 'website',
      agent_id: agent.id,
      visitor_id: visitor,
      status: 'open',
    })
    .select('id')
    .single()
  if (convErr || !conversation?.id) {
    console.error('[widget] conversation insert error:', convErr)
    return null
  }

  return { conversationId: conversation.id, contactId: contact.id }
}

/** Insert a message row and freshen the conversation list preview. */
export async function insertMessage(
  db: SupabaseClient,
  conversationId: string,
  senderType: 'customer' | 'bot',
  text: string,
): Promise<void> {
  const { error } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: senderType,
    content_type: 'text',
    content_text: text,
    status: 'sent',
  })
  if (error) console.error('[is] message insert error:', error)

  const unreadDelta = senderType === 'customer' ? 1 : 0
  await db
    .from('conversations')
    .update({
      last_message_text: text.slice(0, 500),
      last_message_at: new Date().toISOString(),
      unread_count: unreadDelta,
    })
    .eq('id', conversationId)
}