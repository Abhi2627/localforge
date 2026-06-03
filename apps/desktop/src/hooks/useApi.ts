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
    message:   string,
    sessionId: string,
    history:   Array<{ role: string; content: string }>,
    _taskId:   string,
    onChunk:   (chunk: string) => void,
  ): Promise<void> => {
    const res = await fetch(`${BASE}/chat/stream`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message, sessionId, history }),
    })
    if (!res.ok) throw new Error(`Stream failed (${res.status}): ${await res.text()}`)

    const reader  = res.body?.getReader()
    const decoder = new TextDecoder()
    if (!reader) throw new Error('No response body')

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const lines = decoder.decode(value, { stream: true }).split('\n').filter(l => l.startsWith('data: '))
      for (const line of lines) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') return
        try {
          const p = JSON.parse(data)
          if (p.chunk !== undefined) onChunk(p.chunk)
        } catch { }
      }
    }
  },

  // ── Agents ────────────────────────────────────────────────────────────────
  createProject: (name: string, rootPath: string) =>
    req<any>('POST', '/projects', { name, rootPath }),
  createAgent: (projectId: string, name: string, role: string, allowedPaths: string[] = []) =>
    req<any>('POST', `/projects/${projectId}/agents`, { name, role, allowedPaths }),
  instruct: (projectId: string, agentId: string, instruction: string) =>
    req<any>('POST', `/projects/${projectId}/agents/${agentId}/instruct`, { instruction, queue: true }),
}
