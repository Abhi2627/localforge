const BASE = 'http://localhost:3001'

async function req<T>(method: string, path: string, body?: object): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`API ${method} ${path} failed (${res.status}): ${await res.text()}`)
  return res.json()
}

export const api = {
  // ── Models ────────────────────────────────────────────────────────────────
  getModels:     () => req<{ models: any[] }>('GET', '/models'),
  getModelStats: () => req<any>('GET', '/models/stats'),
  selectModel:   (model: string) => req<any>('POST', '/models/select', { model }),
  setFallbacks:  (models: string[]) => req<any>('POST', '/models/fallback', { models }),

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings:     () => req<any>('GET', '/settings'),
  setProvider:     (activeProvider: string, cloudModel?: string) =>
    req<any>('POST', '/settings/provider', { activeProvider, cloudModel }),
  saveApiKey:      (provider: string, apiKey: string, baseUrl?: string) =>
    req<any>('POST', '/settings/apikey', { provider, apiKey, baseUrl }),
  deleteApiKey:    (provider: string) =>
    req<any>('POST', '/settings/apikey/delete', { provider }),
  validateApiKey:  (provider: string, apiKey: string, model: string, baseUrl?: string) =>
    req<{ ok: boolean; error?: string }>('POST', '/settings/apikey/validate', { provider, apiKey, model, baseUrl }),
  saveLLMDefaults: (defaults: Partial<{ temperature: number; maxTokens: number; systemPrompt: string; contextLength: number }>) =>
    req<any>('POST', '/settings/llm', defaults),

  // ── System ────────────────────────────────────────────────────────────────
  getSystem:      () => req<any>('GET', '/system'),
  getNetworkInfo: () => req<{ lanIp: string; hostname: string; platform: string }>('GET', '/network/info'),

  // ── Sessions ──────────────────────────────────────────────────────────────
  getSessions:   () => req<{ sessions: any[] }>('GET', '/sessions'),
  getSession:    (id: string) => req<{ session: any; messages: any[] }>('GET', `/sessions/${id}`),
  createSession: (id: string, type: string, title: string, rootPath?: string, modelName?: string) =>
    req<any>('POST', '/sessions', { id, type, title, rootPath, modelName }),
  deleteSession: (id: string) => req<any>('DELETE', `/sessions/${id}`),
  saveMessage:   (id: string, sessionId: string, role: string, content: string, agentName?: string) =>
    req<any>('POST', '/sessions/message', { id, sessionId, role, content, agentName }),

  // ── Project ───────────────────────────────────────────────────────────────
  openProject: (sessionId: string, rootPath: string) =>
    req<{ success: boolean; isEmpty: boolean; fileList: string[]; fileTree: string; fileCount: number }>(
      'POST', '/project/open', { sessionId, rootPath }),
  getProjectSummary: (sessionId: string) =>
    req<{ summary: string | null }>('GET', `/project/${sessionId}/summary`),

  // Guard: never call with empty path — prevents 400 errors
  readFile: (filePath: string) => {
    if (!filePath || filePath.trim() === '') {
      return Promise.reject(new Error('readFile called with empty path'))
    }
    return req<{ content: string }>('GET', `/project/file?path=${encodeURIComponent(filePath)}`)
  },
  writeFile: (filePath: string, content: string) => {
    if (!filePath || filePath.trim() === '') {
      return Promise.reject(new Error('writeFile called with empty path'))
    }
    return req<{ success: boolean }>('POST', '/project/file', { path: filePath, content })
  },

  // ── Chat ──────────────────────────────────────────────────────────────────
  sendChat: (message: string, sessionId: string, history: any[] = []) =>
    req<{ success: boolean; reply: string }>('POST', '/chat', { message, sessionId, history }),

  streamChat: async (
    message:      string,
    sessionId:    string,
    history:      Array<{ role: string; content: string }>,
    _taskId:      string,
    onChunk:      (chunk: string) => void,
    audienceMode: string = 'college',
    onReplace?:   (content: string) => void,
    opts?:        { web?: boolean; provider?: string; onStatus?: (status: string) => void; onSources?: (sources: Array<{ title: string; url: string }>) => void },
  ): Promise<void> => {
    // Route to the web-augmented endpoint when the Web toggle is on (or @web typed).
    const useWeb = !!opts?.web || /^@web\b/i.test(message.trim())
    const endpoint = useWeb ? '/chat/stream/web' : '/chat/stream'
    const res = await fetch(`${BASE}${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      // provider = the model selected in THIS chat tab (authoritative over the global default)
      body:    JSON.stringify({ message, sessionId, history, audienceMode, forceWeb: useWeb, provider: opts?.provider }),
    })
    if (!res.ok) throw new Error(`Stream failed (${res.status}): ${await res.text()}`)

    const reader  = res.body?.getReader()
    const decoder = new TextDecoder()
    if (!reader) throw new Error('No response body')

    // Stall guard: if no data arrives for STALL_MS (e.g. the web/RAG path hangs),
    // cancel the reader so the loop ends — otherwise the await never resolves and
    // the chat input stays disabled forever.
    const STALL_MS = 90_000
    let stall: ReturnType<typeof setTimeout> | undefined
    const armStall = () => { clearTimeout(stall); stall = setTimeout(() => { try { reader.cancel() } catch { } }, STALL_MS) }

    // Buffer across reads — an SSE line can be split across chunk boundaries,
    // which would otherwise drop tokens (the partial line fails to parse / loses its `data:` prefix).
    let buffer = ''
    try {
      while (true) {
        armStall()
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') return
          try {
            const p = JSON.parse(data)
            if (p.type === 'replace' && typeof p.content === 'string') { onReplace?.(p.content); continue }
            if (p.type === 'rag_status'  && typeof p.status === 'string') { opts?.onStatus?.(p.status); continue }
            if (p.type === 'rag_sources' && Array.isArray(p.sources))      { opts?.onSources?.(p.sources); continue }
            if (p.chunk !== undefined) onChunk(p.chunk)
          } catch { }
        }
      }
    } finally { clearTimeout(stall) }
  },

  // ── Agents ────────────────────────────────────────────────────────────────
  createProject: (name: string, rootPath: string) =>
    req<any>('POST', '/projects', { name, rootPath }),
  createAgent: (projectId: string, name: string, role: string, allowedPaths: string[] = []) =>
    req<any>('POST', `/projects/${projectId}/agents`, { name, role, allowedPaths }),
  instruct: (projectId: string, agentId: string, instruction: string) =>
    req<any>('POST', `/projects/${projectId}/agents/${agentId}/instruct`, { instruction, queue: true }),
}
