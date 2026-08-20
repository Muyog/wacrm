// ============================================================
// POST /api/bamisoro-chat/mirror
//
// Bamisoro Chat Intelligence inbound mirror. The Wema/Nolt WhatsApp
// bot forwards every inbound customer message + the bot's reply here;
// wacrm writes them into the Bamisoro account's inbox so the human
// team can monitor and take over. Authenticated by a shared secret
// (BAMISORO_CHAT_SECRET) in the x-bamisoro-chat-secret header.
//
// Body:
//   {
//     "phone": "+234...",                 // E.164 customer number
//     "name": "Jane Doe",                 // optional WhatsApp profile name
//     "messages": [
//       { "role": "customer", "text": "...", "external_id": "wmid_...", "timestamp": "ISO" },
//       { "role": "bot",     "text": "...", "external_id": "wmid_...", "timestamp": "ISO" }
//     ]
//   }
//
// Response 200: { "data": { contact_id, conversation_id, inserted, skipped } }
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  verifyBamisoroChatSecret,
  BAMISORO_CHAT_SECRET_HEADER,
  bamisoroAccountId,
  bamisoroAuditUserId,
} from '@/lib/bamisoro-chat/auth';
import { mirrorToInbox } from '@/lib/bamisoro-chat/mirror';

export const maxDuration = 30;

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(request: Request) {
  const secret = request.headers.get(BAMISORO_CHAT_SECRET_HEADER);
  if (!verifyBamisoroChatSecret(secret)) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Invalid or missing Bamisoro Chat secret' } }, { status: 401 });
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: 'Body must be JSON' } }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: { code: 'bad_request', message: 'Body must be a JSON object' } }, { status: 400 });
  }

  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  if (!phone) {
    return NextResponse.json({ error: { code: 'bad_request', message: "'phone' is required" } }, { status: 400 });
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return NextResponse.json({ error: { code: 'bad_request', message: "'messages' must be a non-empty array" } }, { status: 400 });
  }

  const accountId = bamisoroAccountId();
  const db = supabaseAdmin();

  const auditUserId = await bamisoroAuditUserId(supabaseAdmin, accountId);
  if (!auditUserId) {
    return NextResponse.json({ error: { code: 'internal', message: 'Could not resolve Bamisoro account owner' } }, { status: 500 });
  }

  try {
    const result = await mirrorToInbox(db, accountId, auditUserId, {
      phone,
      name: typeof body.name === 'string' ? body.name : null,
      messages: messages.map((m) => {
        const mm = m as Record<string, unknown>;
        return {
          role: mm.role === 'bot' ? 'bot' : 'customer',
          text: typeof mm.text === 'string' ? mm.text : '',
          external_id: typeof mm.external_id === 'string' ? mm.external_id : null,
          timestamp: typeof mm.timestamp === 'string' ? mm.timestamp : null,
        };
      }),
    });
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    console.error('[bamisoro-chat] mirror failed:', err);
    return NextResponse.json({ error: { code: 'internal', message: 'Mirror failed' } }, { status: 500 });
  }
}
