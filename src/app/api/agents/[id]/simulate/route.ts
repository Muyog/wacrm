import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { resolveAgentConfig } from '@/lib/ai/agent'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { latestUserMessage } from '@/lib/ai/query'
import type { ChatMessage } from '@/lib/ai/types'

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20

/**
 * POST /api/agents/[id]/simulate
 *
 * Channel-tailored test-chat used by the agent builder's preview panel,
 * WITHOUT touching WhatsApp or the inbox.
 *
 *   - WhatsApp agents: the inbound text is matched against the agent's
 *     attached ACTIVE flows exactly like the webhook does (keyword
 *     contains / first-inbound). On a hit, the flow graph is WALKED
 *     client-side-safe: every deterministic send is emitted as a step
 *     until a suspending node (collect_input) or terminal is reached —
 *     nothing is persisted, no Meta message goes out. When no flow
 *     matches (or response_mode routes to the AI), the agent's own
 *     prompt/key generates the reply — the same path the WhatsApp
 *     webhook uses for bound agents.
 *   - Website agents: straight AI reply (the pre-chat flow runs fully
 *     client-side in the preview, no server round-trip needed).
 *
 * Stateless: the client sends the running transcript each turn, like
 * /api/ai/playground.
 */

interface SimulateStep {
  type: 'text' | 'buttons' | 'list' | 'media'
  text?: string
  header?: string
  footer?: string
  button_label?: string
  buttons?: { title: string }[]
  rows?: { title: string; description?: string }[]
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const { supabase, userId, accountId } = await requireRole('agent')

    const limit = checkRateLimit(`agent-simulate:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    if (!rawMessages) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 })
    }
    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)
    const inboundText = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''

    // Ownership-scoped agent fetch.
    const { data: agent, error: agentErr } = await supabase
      .from('agents')
      .select(
        'id, account_id, name, system_prompt, model_provider, model, temperature, max_tokens, tools, auto_reply_enabled, channel, wa_config, is_active',
      )
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (agentErr || !agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    /* ---------------------------------------------------------------
     * WhatsApp agents — try the attached flows first, exactly like the
     * webhook pipeline (flows win over the AI).
     * --------------------------------------------------------------- */
    const waMode =
      (agent.wa_config as Record<string, unknown> | null)?.response_mode ??
      'flows_then_ai'
    if (
      agent.channel === 'whatsapp' &&
      waMode !== 'ai_only' &&
      inboundText.trim()
    ) {
      const isFirstInbound =
        messages.filter((m) => m.role === 'user').length === 1
      const flow = await findMatchingFlow(
        String(accountId),
        id,
        inboundText,
        isFirstInbound,
      )
      if (flow) {
        const steps = await walkFlow(flow.flowId, flow.entryNodeId)
        return NextResponse.json({
          kind: 'flow',
          flow_name: flow.name,
          steps,
        })
      }
      if (waMode === 'flows_only') {
        return NextResponse.json({
          kind: 'none',
          note: 'No flow matched this message.',
        })
      }
    }

    /* ------------------------- AI reply ------------------------- */
    const resolved = await resolveAgentConfig(
      supabaseAdmin(),
      agent as never,
    )
    if (!resolved) {
      return NextResponse.json({
        kind: 'ai',
        reply: null,
        warning:
          'No AI provider configured — add an API key to this agent or to account AI settings to see real replies.',
      })
    }

    const tools = Array.isArray(agent.tools) ? (agent.tools as unknown[]) : []
    let kb = ''
    if (tools.some((t) => t === 'knowledge_base') && inboundText) {
      try {
        const hits = await retrieveKnowledge(
          supabaseAdmin(),
          String(accountId),
          resolved.config,
          inboundText,
          5,
        )
        if (hits.length > 0) kb = hits.join('\n\n')
      } catch {
        kb = ''
      }
    }
    const customToolLines = tools
      .filter(
        (t) =>
          typeof t === 'object' &&
          t !== null &&
          (t as { type?: string }).type === 'custom',
      )
      .map(
        (t) =>
          `- ${(t as { name: string }).name}: ${(t as { description: string }).description}`,
      )

    const systemPrompt = [
      agent.system_prompt || 'You are a helpful assistant.',
      kb ? `\n\nKnowledge base context:\n${kb}` : '',
      customToolLines.length > 0
        ? `\n\nAdditional capabilities you can offer the user (describe honestly; if an action requires data you do not have, say what you need):\n${customToolLines.join('\n')}`
        : '',
      `\n\nCurrent date: ${new Date().toISOString().slice(0, 10)}`,
    ].join('')

    const result = await generateReply({
      config: resolved.config,
      systemPrompt,
      messages,
    })
    return NextResponse.json({
      kind: 'ai',
      reply: result.text,
      handoff: result.handoff ?? false,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/* ------------------------------------------------------------------ */
/* Flow matching — mirrors the webhook's entry-trigger semantics       */
/* ------------------------------------------------------------------ */

interface MatchedFlow {
  flowId: string
  name: string
  entryNodeId: string | null
}

async function findMatchingFlow(
  accountId: string,
  agentId: string,
  text: string,
  isFirstInbound: boolean,
): Promise<MatchedFlow | null> {
  const db = supabaseAdmin()
  const { data: flows } = await db
    .from('flows')
    .select('id, name, status, trigger_type, trigger_config, entry_node_id')
    .eq('account_id', accountId)
    .eq('agent_id', agentId)
    .eq('status', 'active')
  if (!flows) return null

  const lower = text.toLowerCase()
  for (const f of flows) {
    if (f.trigger_type === 'keyword') {
      const kws =
        ((f.trigger_config as Record<string, unknown>)?.keywords as
          | string[]
          | undefined) ?? []
      if (kws.some((k) => k && lower.includes(k.toLowerCase()))) {
        return { flowId: f.id, name: f.name, entryNodeId: f.entry_node_id }
      }
    } else if (f.trigger_type === 'first_inbound_message' && isFirstInbound) {
      return { flowId: f.id, name: f.name, entryNodeId: f.entry_node_id }
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Flow walking — emit deterministic sends until suspend/terminal.     */
/* Mirrors engine.ts node semantics without touching DB writes/Meta.   */
/* ------------------------------------------------------------------ */

async function walkFlow(
  flowId: string,
  entryNodeId: string | null,
): Promise<SimulateStep[]> {
  if (!entryNodeId) return []
  const db = supabaseAdmin()
  const { data: nodes } = await db
    .from('flow_nodes')
    .select('node_key, node_type, config')
    .eq('flow_id', flowId)
  if (!nodes) return []

  const byKey = new Map<string, { node_type: string; config: Record<string, unknown> }>()
  for (const n of nodes) byKey.set(n.node_key, n)

  const steps: SimulateStep[] = []
  let cursor: string | null = entryNodeId
  let guard = 0
  while (cursor && guard++ < 50) {
    const node = byKey.get(cursor)
    if (!node) break
    const cfg = node.config as Record<string, unknown>

    switch (node.node_type) {
      case 'send_message':
        steps.push({ type: 'text', text: String(cfg.text ?? '') })
        cursor = (cfg.next_node_key as string) ?? null
        break
      case 'send_buttons':
        steps.push({
          type: 'buttons',
          text: String(cfg.text ?? ''),
          header: cfg.header_text ? String(cfg.header_text) : undefined,
          footer: cfg.footer_text ? String(cfg.footer_text) : undefined,
          buttons: ((cfg.buttons as { title?: string }[] | undefined) ?? [])
            .slice(0, 3)
            .map((b) => ({ title: String(b.title ?? '') })),
        })
        cursor = (cfg.next_node_key as string) ?? null
        break
      case 'send_list': {
        const sections =
          (cfg.sections as
            | { rows?: { title?: string; description?: string }[] }[]
            | undefined) ?? []
        steps.push({
          type: 'list',
          text: String(cfg.text ?? ''),
          button_label: cfg.button_label
            ? String(cfg.button_label)
            : undefined,
          rows: sections
            .flatMap((s) => s.rows ?? [])
            .slice(0, 10)
            .map((r) => ({
              title: String(r.title ?? ''),
              description: r.description ? String(r.description) : undefined,
            })),
        })
        cursor = (cfg.next_node_key as string) ?? null
        break
      }
      case 'send_media':
        steps.push({
          type: 'media',
          text: cfg.caption ? String(cfg.caption) : undefined,
        })
        cursor = (cfg.next_node_key as string) ?? null
        break
      case 'collect_input':
        // Suspending node — the run waits for the customer's next message.
        steps.push({ type: 'text', text: String(cfg.prompt_text ?? '') })
        cursor = null
        break
      case 'condition': {
        // Preview has no stored vars/tags → "present" predicates are
        // false, "absent" predicates true. Same first-touch reality a
        // new customer would hit.
        const op = String(cfg.operator ?? '')
        cursor = String(
          op === 'absent' ? (cfg.true_next as string) : (cfg.false_next as string),
        )
        break
      }
      case 'set_tag':
        cursor = (cfg.next_node_key as string) ?? null
        break
      case 'handoff':
      case 'end':
        cursor = null
        break
      default:
        cursor = null
    }
  }
  return steps
}
