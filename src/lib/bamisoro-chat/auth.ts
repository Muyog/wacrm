// ============================================================
// Bamisoro Chat Intelligence — shared-secret auth.
//
// The Wema/Nolt WhatsApp bot (bamisoro-whatsapp, deployed on
// Vercel) forwards every inbound customer message + the bot's reply
// into wacrm's inbox via /api/bamisoro-chat/mirror. That endpoint is
// NOT an open public API — it is a single trusted integration, so we
// authenticate with a shared secret (BAMISORO_CHAT_SECRET) instead of
// the multi-key API-key machinery.
//
// The secret is compared with a constant-time compare so a timing
// side-channel can't be used to brute-force it. Missing/empty secret
// fails closed (rejects) so the endpoint is never spoofable if the
// operator forgets to set the env var.
// ============================================================

import crypto from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

/** Header the bot sends the shared secret in. */
export const BAMISORO_CHAT_SECRET_HEADER = 'x-bamisoro-chat-secret';

/**
 * Verify the shared secret from the request against the configured
 * BAMISORO_CHAT_SECRET. Returns true only on an exact, constant-time
 * match. Missing configured secret → false (fail closed).
 */
export function verifyBamisoroChatSecret(provided: string | null): boolean {
  const expected = process.env.BAMISORO_CHAT_SECRET;
  if (!expected || typeof expected !== 'string' || expected.length === 0) {
    console.error(
      '[bamisoro-chat] BAMISORO_CHAT_SECRET is not configured — rejecting request.',
    );
    return false;
  }
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * The single wacrm account the bot mirrors into. Configured via
 * BAMISORO_ACCOUNT_ID; falls back to the first (only) account when
 * unset so a fresh deploy still works, but operators should pin it.
 */
export function bamisoroAccountId(): string {
  return (
    process.env.BAMISORO_ACCOUNT_ID ||
    // Default to the Bamisoro owner account provisioned for this integration.
    '89dd8dad-81f9-4cb2-ac0e-91ac418ec8bb'
  );
}

/**
 * Resolve the audit user_id (NOT NULL FK on contacts/conversations).
 * Mirrors resolveAuditUserId: the account owner. We look it up at
 * request time so it stays correct even if ownership changes.
 */
export async function bamisoroAuditUserId(
  supabaseAdmin: () => SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle();
  if (error || !data?.owner_user_id) return null;
  return data.owner_user_id;
}
