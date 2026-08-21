// ============================================================
// Topic extraction — lightweight keyword/phrase extraction
// that runs after a message is stored, so the dashboard always
// has fresh trending topics without an external service.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js'

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about', 'up',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you',
  'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them',
  'their', 'theirs', 'themselves', 'am', 'been', 'being', 'had', 'has',
  'having', 'do', 'does', 'doing', 'a', 'an', 'the', 'and', 'but', 'if',
  'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for',
  'with', 'about', 'against', 'between', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in',
  'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
])

/**
 * Extract meaningful unigrams and bigrams from message text.
 * Returns a deduped list of topic candidates (lowercased, trimmed).
 */
function extractTopicCandidates(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const words = cleaned.split(' ').filter((w) => w.length > 2 && !STOP_WORDS.has(w))

  const candidates: string[] = []
  // unigrams
  for (const w of words) candidates.push(w)
  // bigrams
  for (let i = 0; i < words.length - 1; i++) {
    candidates.push(`${words[i]} ${words[i + 1]}`)
  }
  // dedupe preserving order
  return [...new Set(candidates)]
}

const TOPIC_COLORS = ['#7c3aed', '#25D366', '#f59e0b', '#3b82f6', '#ef4444', '#ec4899', '#14b8a6', '#8b5cf6']

/**
 * Extract topics from a customer message and attach them to the
 * conversation. Creates topic catalog rows as needed. Best-effort
 * — never throws (failures are logged, not surfaced).
 */
export async function extractAndTagTopics(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  messageText: string,
): Promise<void> {
  try {
    const candidates = extractTopicCandidates(messageText).slice(0, 6)
    if (candidates.length === 0) return

    for (const label of candidates) {
      // Upsert topic (account-scoped, unique by label)
      const { data: existing } = await db
        .from('topics')
        .select('id')
        .eq('account_id', accountId)
        .eq('label', label)
        .maybeSingle()

      let topicId: string
      if (existing?.id) {
        topicId = existing.id
      } else {
        const { data: created, error: createErr } = await db
          .from('topics')
          .insert({
            account_id: accountId,
            label,
            color: TOPIC_COLORS[Math.floor(Math.random() * TOPIC_COLORS.length)],
          })
          .select('id')
          .single()
        if (createErr || !created?.id) continue
        topicId = created.id
      }

      // Attach to conversation (idempotent — PK is (conversation_id, topic_id))
      await db.from('conversation_topics').insert(
        { conversation_id: conversationId, topic_id: topicId },
      ).then(({ error }) => {
        if (error && !error.code.includes('23505')) console.error('[topics] attach error:', error)
      })
    }
  } catch (err) {
    console.error('[topics] extract error:', err)
  }
}