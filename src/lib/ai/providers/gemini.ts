import { AiError, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

// Google offers an OpenAI-compatible endpoint. Base URL includes the
// API version; the model goes in the body like OpenAI.
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'

interface GeminiResponse {
  choices?: { message?: { content?: string } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/**
 * Call Google Gemini via its OpenAI-compatible chat completions
 * endpoint with the caller's own key. Returns raw assistant text +
 * token usage (handoff parsing happens in `generateReply`).
 */
export async function generateGemini(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...mergeConsecutive(messages),
        ],
        max_completion_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Gemini', res)
  }

  const data = (await res.json().catch(() => null)) as GeminiResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('Gemini returned an empty response.', {
      code: 'empty_response',
      status: 502,
    })
  }

  return {
    text,
    usage: normalizeUsage({
      prompt: data.usage?.prompt_tokens ?? null,
      completion: data.usage?.completion_tokens ?? null,
      total: data.usage?.total_tokens ?? null,
    }),
  }
}