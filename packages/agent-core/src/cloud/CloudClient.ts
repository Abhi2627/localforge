/**
 * CloudClient.ts
 *
 * Unified cloud LLM client supporting:
 * - OpenAI (api.openai.com)
 * - Google Gemini (via OpenAI-compatible endpoint)
 * - Anthropic Claude (via OpenAI-compatible endpoint)
 * - Groq (via OpenAI-compatible endpoint)
 * - Any custom OpenAI-compatible endpoint
 */

export type CloudProvider = 'openai' | 'gemini' | 'claude' | 'groq' | 'custom'

export interface CloudProviderConfig {
  provider:  CloudProvider
  apiKey:    string
  model:     string
  baseUrl?:  string
}

export interface ChatMessage {
  role:    'system' | 'user' | 'assistant'
  content: string
}

export interface StreamChunk {
  content: string
  done:    boolean
}

const BASE_URLS: Record<CloudProvider, string> = {
  openai:  'https://api.openai.com',
  gemini:  'https://generativelanguage.googleapis.com/v1beta/openai',
  claude:  'https://api.anthropic.com',
  groq:    'https://api.groq.com/openai',
  custom:  '',
}

export const DEFAULT_MODELS: Record<CloudProvider, string[]> = {
  openai:  ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  gemini:  ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-lite'],
  claude:  ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-6'],
  groq:    ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
  custom:  [],
}

export const PROVIDER_LABELS: Record<CloudProvider, string> = {
  openai:  'OpenAI',
  gemini:  'Google Gemini',
  claude:  'Anthropic Claude',
  groq:    'Groq',
  custom:  'Custom (OpenAI-compatible)',
}

export async function cloudChat(
  config:   CloudProviderConfig,
  messages: ChatMessage[],
  onChunk?: (chunk: StreamChunk) => void,
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const baseUrl = config.provider === 'custom'
    ? (config.baseUrl ?? '').replace(/\/$/, '')
    : BASE_URLS[config.provider]

  if (!baseUrl)      throw new Error(`No base URL for provider "${config.provider}"`)
  if (!config.apiKey) throw new Error(`No API key for provider "${config.provider}"`)

  const url  = `${baseUrl}/v1/chat/completions`
  const body = JSON.stringify({
    model:       config.model,
    messages,
    stream:      !!onChunk,
    temperature: options?.temperature ?? 0.7,
    max_tokens:  options?.maxTokens   ?? 4096,
  })

  const headers: Record<string, string> = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
  }

  const res = await fetch(url, { method: 'POST', headers, body })

  if (!res.ok) {
    const errText = await res.text()
    let errMsg = `${PROVIDER_LABELS[config.provider]} API error (${res.status})`
    try { errMsg = JSON.parse(errText)?.error?.message ?? errMsg } catch { }
    throw new Error(errMsg)
  }

  if (!onChunk) {
    const data = await res.json() as { choices: Array<{ message: { content: string } }> }
    return data.choices[0]?.message?.content ?? ''
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body for streaming')

  const decoder = new TextDecoder()
  let fullContent = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    // Buffer across reads — an SSE line can be split across chunk boundaries.
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''   // keep the trailing (possibly incomplete) line
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const json = trimmed.slice(5).trim()
      if (json === '[DONE]') continue
      try {
        const chunk = JSON.parse(json) as {
          choices: Array<{ delta: { content?: string }; finish_reason?: string }>
        }
        const content = chunk.choices[0]?.delta?.content ?? ''
        const isDone  = chunk.choices[0]?.finish_reason != null  // 'stop' | 'length' | 'content_filter' | …
        fullContent  += content
        if (content) onChunk({ content, done: isDone })
      } catch { }
    }
  }

  return fullContent
}

export async function validateApiKey(config: CloudProviderConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    await cloudChat(config, [{ role: 'user', content: 'hi' }], undefined, { maxTokens: 5 })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}
