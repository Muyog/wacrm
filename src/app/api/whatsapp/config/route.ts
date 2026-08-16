import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

/**
 * GET /api/whatsapp/config — list all WhatsApp numbers for the account.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ configs: [] })
    }

    const { data, error } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('id, phone_number_id, waba_id, verify_token, status, connected_at, registered_at, subscribed_apps_at, last_registration_error, agent_id, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[whatsapp/config GET]', error)
      return NextResponse.json({ error: 'Failed to load configs' }, { status: 500 })
    }

    // Mask tokens in response.
    const safe = (data ?? []).map((row: any) => ({
      ...row,
      has_access_token: !!row.access_token,
      has_verify_token: !!row.verify_token,
      access_token: undefined,
      verify_token: undefined,
    }))
    return NextResponse.json({ configs: safe })
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/whatsapp/config — add a NEW WhatsApp number to the account.
 * Multiple numbers supported (multi-Meta). Each can bind to an agent.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const body = await request.json()
    const { phone_number_id, waba_id, access_token, verify_token, pin, agent_id } = body

    if (!access_token || !phone_number_id) {
      return NextResponse.json({ error: 'access_token and phone_number_id are required' }, { status: 400 })
    }
    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json({ error: 'PIN must be exactly 6 digits.' }, { status: 400 })
      }
    }

    // Check this phone_number_id is not claimed by ANOTHER account.
    const { data: claimed } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phone_number_id)
      .neq('account_id', accountId)
      .maybeSingle()
    if (claimed) {
      return NextResponse.json(
        { error: 'This WhatsApp phone number is already linked to another account.' },
        { status: 409 },
      )
    }

    // If agent_id is provided, verify it belongs to this account.
    if (agent_id) {
      const { data: agent } = await supabaseAdmin()
        .from('agents')
        .select('id')
        .eq('id', agent_id)
        .eq('account_id', accountId)
        .maybeSingle()
      if (!agent) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
      }
    }

    // Verify credentials with Meta.
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({ phoneNumberId: phone_number_id, accessToken: access_token })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      return NextResponse.json({ error: `Meta API error: ${message}` }, { status: 400 })
    }

    // Encrypt tokens.
    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null
    try {
      encryptedAccessToken = encrypt(access_token)
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null
    } catch (err) {
      return NextResponse.json(
        { error: 'Failed to encrypt token. Check ENCRYPTION_KEY.' },
        { status: 500 },
      )
    }

    // Check if THIS account already has this number (re-configure case).
    const { data: existingOfAccount } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('id, registered_at')
      .eq('account_id', accountId)
      .eq('phone_number_id', phone_number_id)
      .maybeSingle()

    const sameNumber = !!existingOfAccount

    // Register with Meta.
    let registeredAt: string | null = existingOfAccount?.registered_at ?? null
    let registrationError: string | null = null
    let registrationSkipped = false
    const needsRegistration = !sameNumber || (typeof pin === 'string' && pin.length > 0)

    if (needsRegistration) {
      if (!pin) {
        registrationSkipped = true
      } else {
        try {
          await registerPhoneNumber({ phoneNumberId: phone_number_id, accessToken: access_token, pin })
          registeredAt = new Date().toISOString()
        } catch (err) {
          registrationError = err instanceof Error ? err.message : 'Unknown Meta API error'
          console.error('Phone number /register failed:', registrationError)
        }
      }
    }

    let subscribedAppsAt: string | null = null
    if (waba_id) {
      try {
        await subscribeWabaToApp({ wabaId: waba_id, accessToken: access_token })
        subscribedAppsAt = new Date().toISOString()
      } catch (err) {
        console.warn('WABA subscribed_apps failed (non-fatal):', err)
      }
    }

    const baseRow: Record<string, any> = {
      phone_number_id,
      waba_id: waba_id || null,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      status: registrationError ? 'disconnected' : 'connected',
      connected_at: registrationError ? null : new Date().toISOString(),
      registered_at: registrationError ? null : registeredAt,
      subscribed_apps_at: subscribedAppsAt ?? null,
      last_registration_error: registrationError,
      updated_at: new Date().toISOString(),
      agent_id: agent_id || null,
    }

    let savedId: string
    if (existingOfAccount) {
      await supabaseAdmin().from('whatsapp_config').update(baseRow).eq('id', existingOfAccount.id)
      savedId = existingOfAccount.id
    } else {
      const { data: inserted, error: insertError } = await supabaseAdmin()
        .from('whatsapp_config')
        .insert({ account_id: accountId, user_id: user.id, ...baseRow })
        .select('id')
        .single()
      if (insertError) {
        console.error('Error inserting whatsapp_config:', insertError)
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
      }
      savedId = inserted.id
    }

    if (registrationError) {
      return NextResponse.json({
        success: false, saved: true, registered: false, registration_error: registrationError, id: savedId,
      })
    }
    return NextResponse.json({
      success: true, saved: true, registered: registeredAt != null, registration_skipped: registrationSkipped, id: savedId,
    })
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/whatsapp/config — update an existing number's agent binding.
 */
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }
    const body = await request.json()
    const { id, agent_id } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    if (agent_id) {
      const { data: agent } = await supabaseAdmin()
        .from('agents')
        .select('id')
        .eq('id', agent_id)
        .eq('account_id', accountId)
        .maybeSingle()
      if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const { error } = await supabaseAdmin()
      .from('whatsapp_config')
      .update({ agent_id: agent_id || null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config PATCH:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/config — remove one of the account's numbers.
 */
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }
    const { id } = await request.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { error } = await supabaseAdmin()
      .from('whatsapp_config')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}