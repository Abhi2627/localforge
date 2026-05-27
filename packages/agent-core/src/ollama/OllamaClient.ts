import https from 'http'

const OLLAMA_BASE = process.env.OLLAMA_HOST ?? 'http://localhost:11434'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface OllamaModel {
  name: string
  size: number
  modified_at: string
}

export interface StreamChunk {
  content: string
  done: boolean
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
  const body = JSON.stringify({
    model,
    messages,
    stream: !!onChunk
  })

  const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Ollama chat failed (${res.status}): ${err}`)
  }

  if (!onChunk) {
    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>
    }
    return data.choices[0]?.message?.content ?? ''
  }

  // Streaming path
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body for streaming')

  const decoder = new TextDecoder()
  let fullContent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const lines = decoder.decode(value).split('\n').filter(l => l.startsWith('data: '))
    for (const line of lines) {
      const json = line.slice(6).trim()
      if (json === '[DONE]') continue
      try {
        const chunk = JSON.parse(json) as {
          choices: Array<{ delta: { content?: string }; finish_reason?: string }>
        }
        const content = chunk.choices[0]?.delta?.content ?? ''
        const isDone  = chunk.choices[0]?.finish_reason === 'stop'
        fullContent += content
        onChunk({ content, done: isDone })
      } catch {
        // Incomplete chunk, skip
      }
    }
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
    const available = await isModelAvailable(model)
    if (!available) {
      console.warn(`[OllamaClient] Model ${model} not available, trying next`)
      continue
    }
    try {
      const content = await chat(model, messages, onChunk)
      return { content, modelUsed: model }
    } catch (err) {
      console.error(`[OllamaClient] Model ${model} failed:`, err)
    }
  }

  throw new Error(`All models failed: ${chain.join(', ')}`)
}
