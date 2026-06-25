const OLLAMA_BASE = process.env.OLLAMA_HOST ?? 'http://localhost:11434'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface OllamaModel {
  name: string
  size: number
  modified_at: string
  details?: { parameter_size?: string; quantization_level?: string; family?: string }
}

export interface StreamChunk {
  content: string
  done:    boolean
}

export async function listModels(): Promise<OllamaModel[]> {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`)
  if (!res.ok) throw new Error(`Ollama unreachable: ${res.status}`)
  const data = await res.json() as { models: OllamaModel[] }
  return data.models ?? []
}

export async function isModelAvailable(modelName: string): Promise<boolean> {
  const models = await listModels()
  return models.some(m => m.name === modelName || m.name.startsWith(modelName.split(':')[0]))
}

export async function chat(
  model: string,
  messages: ChatMessage[],
  onChunk?: (chunk: StreamChunk) => void
): Promise<string> {
  // Lazy import metrics to avoid circular deps
  const { recordSuccess, recordError } = await import('./ModelMetrics.js')

  const body = JSON.stringify({ model, messages, stream: !!onChunk })
  const start = Date.now()

  const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })

  if (!res.ok) {
    const err = await res.text()
    recordError(model, `HTTP ${res.status}: ${err}`)
    throw new Error(`Ollama chat failed (${res.status}): ${err}`)
  }

  if (!onChunk) {
    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>
      usage?:  { completion_tokens?: number }
    }
    const content = data.choices[0]?.message?.content ?? ''
    const tokens  = data.usage?.completion_tokens ?? Math.round(content.length / 4)
    recordSuccess(model, tokens, Date.now() - start)
    return content
  }

  // Streaming path — accumulate and record at end
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body for streaming')

  const decoder = new TextDecoder()
  let fullContent = ''
  let tokenCount  = 0
  let buffer      = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      // { stream: true } prevents corrupting multi-byte chars split across chunks;
      // buffer retains an incomplete trailing line until the rest arrives.
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
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
          const isDone  = chunk.choices[0]?.finish_reason === 'stop'
          fullContent  += content
          tokenCount   += content.length > 0 ? 1 : 0
          onChunk({ content, done: isDone })
        } catch { }
      }
    }
    const tokens = Math.max(tokenCount, Math.round(fullContent.length / 4))
    recordSuccess(model, tokens, Date.now() - start)
  } catch (err: any) {
    recordError(model, err.message ?? 'Stream error')
    throw err
  }

  return fullContent
}

export async function chatWithFallback(
  preferredModel: string,
  fallbackModels: string[],
  messages: ChatMessage[],
  onChunk?: (chunk: StreamChunk) => void
): Promise<{ content: string; modelUsed: string }> {
  const chain = [preferredModel, ...fallbackModels]
  for (const model of chain) {
    if (!await isModelAvailable(model)) {
      console.warn(`[OllamaClient] ${model} not available, trying next`)
      continue
    }
    try {
      const content = await chat(model, messages, onChunk)
      return { content, modelUsed: model }
    } catch (err) {
      console.error(`[OllamaClient] ${model} failed:`, err)
    }
  }
  throw new Error(`All models failed: ${chain.join(', ')}`)
}
