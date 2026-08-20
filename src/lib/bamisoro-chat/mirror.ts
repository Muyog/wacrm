// ============================================================
// Bamisoro Chat Intelligence — inbound mirror engine.
//
// Reused by /api/bamisoro-chat/mirror. The Wema/Nolt WhatsApp bot
// POSTs (a) the customer's inbound message and (b) the bot's reply;
// this mirrors BOTH into wacrm's inbox so the human team can watch the
// conversation and take over.
//
// Design (first principles):
//   * Reuse wacrm's EXACT contact/conversation find-or-create and
//     message-insert mechanics so a mirrored thread is visually and
//     relationally indistinguishable from a native WhatsApp thread.
//   * The customer message is stored with sender_type='customer' and
//     bumps unread + conversation preview via the same
//     bump_conversation_on_inbound RPC the real webhook uses.
//   * The bot reply is stored with sender_type='bot' (an allowed
//     value in messages.sender_type) and refreshes the conversation
//     preview WITHOUT incrementing unread (it's our side's message).
//   * Idempotent per (conversation, external_id) so Meta retries /
//     bot-at-least-once delivery never double-insert. external_id is
//     the bot's own message id when available.
//
// NOTE: this does NOT call Meta, does NOT run automations/flows/AI
// reply, and does NOT fire public webhooks — those belong to wacrm's
// own number. This is a pure mirror of an external bot's transcript.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';

export interface MirrorMessage {
  /** 'customer' = inbound from the end user; 'bot' = the assistant reply. */
  role: 'customer' | 'bot';
  text: string;
  /** Optional external id (bot message id) for idempotency. */
  external_id?: string | null;
  /** Optional ISO timestamp; defaults to now. */
  timestamp?: string | null;
}

export interface MirrorRequest {
  phone: string;
  name?: string | null;
  /** Ordered list of messages to mirror (usually [customerMsg, botMsg]). */
  messages: MirrorMessage[];
}

export interface MirrorResult {
  contact_id: string;
  conversation_id: string;
  inserted: number;
  skipped: number;
}

function isUniqueViolationErr(error: unknown): boolean {
  return isUniqueViolation(error);
}

async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  phone: string,
  name?: string | null,
) {
  const existing = await findExistingContact(db, accountId, phone);
  if (existing) {
    if (name && name !== existing.name) {
      await db.from('contacts').update({ name, updated_at: new Date().toISOString() }).eq('id', existing.id);
    }
    return { id: existing.id, created: false };
  }
  const { data, error } = await db
    .from('contacts')
    .insert({ account_id: accountId, user_id: auditUserId, phone, name: name || phone })
    .select('id')
    .single();
  if (error || !data) {
    if (isUniqueViolationErr(error)) {
      const raced = await findExistingContact(db, accountId, phone);
      if (raced) return { id: raced.id, created: false };
    }
    throw new Error(`Failed to create contact: ${JSON.stringify(error)}`);
  }
  return { id: data.id, created: true };
}

async function findOrCreateConversation(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  contactId: string,
) {
  const { data: existingRows, error: findError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (findError) throw new Error(`Failed to find conversation: ${JSON.stringify(findError)}`);
  if (existingRows && existingRows.length > 0) return { id: existingRows[0].id, created: false };

  const { data: newConv, error: createError } = await db
    .from('conversations')
    .insert({ account_id: accountId, user_id: auditUserId, contact_id: contactId, channel: 'whatsapp' })
    .select('id')
    .single();
  if (createError || !newConv) {
    if (isUniqueViolationErr(createError)) {
      const { data: raced } = await db
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1);
      if (raced && raced.length > 0) return { id: raced[0].id, created: false };
    }
    throw new Error(`Failed to create conversation: ${JSON.stringify(createError)}`);
  }
  return { id: newConv.id, created: true };
}

async function insertMessage(
  db: SupabaseClient,
  conversationId: string,
  accountId: string,
  role: 'customer' | 'bot',
  text: string,
  externalId: string | null,
  timestampIso: string,
): Promise<'inserted' | 'skipped'> {
  // Idempotency: if an external_id was provided and already stored for
  // this conversation, skip (replay). We keep a stable key by storing
  // external_id into message_id (the unique index covers
  // (conversation_id, message_id)). For customer messages we always
  // have an external_id from the bot; if missing we still allow insert
  // (best-effort) but won't be replay-safe.
  if (externalId) {
    const { data: prior } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('message_id', externalId)
      .maybeSingle();
    if (prior) return 'skipped';
  }

  const { error } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: role,
    content_type: 'text',
    content_text: text,
    message_id: externalId,
    status: 'delivered',
    created_at: timestampIso,
  });
  if (error) {
    if (isUniqueViolationErr(error)) return 'skipped';
    throw new Error(`Failed to insert message: ${JSON.stringify(error)}`);
  }
  return 'inserted';
}

/**
 * Mirror a batch of messages for one phone into the account's inbox.
 */
export async function mirrorToInbox(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  req: MirrorRequest,
): Promise<MirrorResult> {
  const phone = req.phone?.trim();
  if (!phone) throw new Error("'phone' is required");
  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    throw new Error("'messages' must be a non-empty array");
  }

  const contact = await findOrCreateContact(db, accountId, auditUserId, phone, req.name);
  const conversation = await findOrCreateConversation(db, accountId, auditUserId, contact.id);

  let inserted = 0;
  let skipped = 0;
  let lastPreview = '';

  for (const m of req.messages) {
    const text = typeof m.text === 'string' ? m.text : '';
    if (!text) continue;
    const ts = m.timestamp && !Number.isNaN(Date.parse(m.timestamp))
      ? new Date(m.timestamp).toISOString()
      : new Date().toISOString();
    const outcome = await insertMessage(
      db,
      conversation.id,
      accountId,
      m.role,
      text,
      m.external_id ?? null,
      ts,
    );
    if (outcome === 'inserted') {
      inserted++;
      lastPreview = text;
      if (m.role === 'customer') {
        // Same atomic inbound bump the real webhook uses.
        await db.rpc('bump_conversation_on_inbound', {
          p_conversation_id: conversation.id,
          p_last_message_text: text,
        });
      } else {
        // Our side's message: refresh preview + timestamp, never unread.
        await db
          .from('conversations')
          .update({ last_message_text: text, last_message_at: ts, updated_at: ts })
          .eq('id', conversation.id);
      }
    } else {
      skipped++;
    }
  }

  return {
    contact_id: contact.id,
    conversation_id: conversation.id,
    inserted,
    skipped,
  };
}
