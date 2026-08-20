// ============================================================
// GET/PUT /api/bamisoro-chat/config
//
// Bamisoro Chat Intelligence configuration endpoint.
//
//   GET  (bot, x-bamisoro-chat-secret) -> the live Nola config the
//        bot should use to answer: { system_prompt, model, temperature,
//        tools, meta }. Ensures the agent row exists (seed w/ defaults).
//
//   GET  (admin session)               -> same config (for the UI).
//   PUT  (admin session)               -> save edited config.
//
// Editing from wacrm means: the human team opens the Bamisoro Chat
// Intelligence settings (admin-only), changes the system prompt / model
// / tools, and the next inbound WhatsApp message the bot receives reads
// the new config automatically. No Vercel redeploy needed.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  BAMISORO_CHAT_SECRET_HEADER,
  verifyBamisoroChatSecret,
  bamisoroAccountId,
} from '@/lib/bamisoro-chat/auth';
import {
  ensureBamisoroAgent,
  findBamisoroAgent,
  saveBamisoroConfig,
  type BamisoroChatConfig,
} from '@/lib/bamisoro-chat/config';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export const maxDuration = 30;

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(request: Request) {
  // Bot path: shared-secret auth, service-role client.
  const secret = request.headers.get(BAMISORO_CHAT_SECRET_HEADER);
  if (secret && verifyBamisoroChatSecret(secret)) {
    const accountId = bamisoroAccountId();
    const db = supabaseAdmin();
    try {
      const agent = await ensureBamisoroAgent(db, accountId);
      return NextResponse.json({ data: agent.config }, { status: 200 });
    } catch (err) {
      console.error('[bamisoro-chat] config GET failed:', err);
      return NextResponse.json({ error: { code: 'internal', message: 'Config read failed' } }, { status: 500 });
    }
  }

  // UI path: admin session.
  try {
    const ctx = await requireRole('admin');
    const agent = await findBamisoroAgent(ctx.supabase, ctx.accountId);
    if (!agent) {
      return NextResponse.json({ data: null, message: 'Not configured yet' }, { status: 200 });
    }
    return NextResponse.json({ data: agent.config }, { status: 200 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  // Editing requires an admin session (RLS-scoped to the caller's account).
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json().catch(() => null)) as Partial<BamisoroChatConfig> | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
    }

    const agent = await findBamisoroAgent(ctx.supabase, ctx.accountId);
    if (!agent) {
      return NextResponse.json({ error: 'Bamisoro Chat Intelligence is not set up for this account' }, { status: 404 });
    }

    const current = agent.config;
    const next: BamisoroChatConfig = {
      system_prompt: typeof body.system_prompt === 'string' ? body.system_prompt : current.system_prompt,
      model: typeof body.model === 'string' ? body.model : current.model,
      temperature: typeof body.temperature === 'number' ? body.temperature : current.temperature,
      tools: Array.isArray(body.tools) ? body.tools : current.tools,
      meta: { button_delimiter: '|||' },
    };

    await saveBamisoroConfig(ctx.supabase, agent.id, next);
    return NextResponse.json({ data: next }, { status: 200 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
