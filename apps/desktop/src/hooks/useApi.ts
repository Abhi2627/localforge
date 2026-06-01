const BASE = 'http://localhost:3001'

async function req<T>(method: string, path: string, body?: object): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`API ${method} ${path} failed (${res.status}): ${err}`)
  }
  return res.json()
}

export interface RAGSource { title: string; url: string }

export interface StreamCallbacks {
  onChunk:       (chunk: string) => void
  onRagStatus?:  (status: string) => void
  onRagSources?: (sources: RAGSource[]) => void
}

async function doStream(
  endpoint:  string,
  message:   string,
  sessionId: string,
  history:   Array<{ role: string; content: string }>,
  callbacks: StreamCallbacks
): Promise<void> {
  const res = await fetch(`${BASE}${endpoint}`, {
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
        const parsed = JSON.parse(data)
        if (parsed.chunk !== undefined)        callbacks.onChunk(parsed.chunk)
        if (parsed.type === 'rag_status')      callbacks.onRagStatus?.(parsed.status)
        if (parsed.type === 'rag_sources')     callbacks.onRagSources?.(parsed.sources)
      } catch { }
    }
  }
}

export const api = {
  getModels:     () => req<{ models: any[] }>('GET', '/models'),
  getModelStats: () => req<any>('GET', '/models/stats'),
  selectModel:   (model: string) => req<any>('POST', '/models/select', { model }),
  setFallbacks:  (models: string[]) => req<any>('POST', '/models/fallback', { models }),
  getSystem:     () => req<any>('GET', '/system'),
  getNetworkInfo:() => req<{ lanIp: string; hostname: string; platform: string }>('GET', '/network/info'),

  getSessions:   () => req<{ sessions: any[] }>('GET', '/sessions'),
  getSession:    (id: string) => req<{ session: any; messages: any[] }>('GET', `/sessions/${id}`),
  createSession: (id: string, type: string, title: string, rootPath?: string, modelName?: string) =>
    req<any>('POST', '/sessions', { id, type, title, rootPath, modelName }),
  deleteSession: (id: string) => req<any>('DELETE', `/sessions/${id}`),
  saveMessage:   (id: string, sessionId: string, role: string, content: string, agentName?: string) =>
    req<any>('POST', '/sessions/message', { id, sessionId, role, content, agentName }),

  openProject:       (sessionId: string, rootPath: string) =>
    req<{ success: boolean; isEmpty: boolean; fileList: string[]; fileTree: string; fileCount: number }>(
      'POST', '/project/open', { sessionId, rootPath }
    ),
  getProjectSummary: (sessionId: string) =>
    req<{ summary: string | null }>('GET', `/project/${sessionId}/summary`),
  readFile:          (filePath: string) =>
    req<{ content: string }>('GET', `/project/file?path=${encodeURIComponent(filePath)}`),
  writeFile:         (filePath: string, content: string) =>
    req<{ success: boolean }>('POST', '/project/file', { path: filePath, content }),

  sendChat: (message: string, sessionId: string, history: any[] = []) =>
    req<{ success: boolean; reply: string }>('POST', '/chat', { message, sessionId, history }),

  // Standard stream — no RAG, always fast
  streamChat: (
    message:   string,
    sessionId: string,
    history:   Array<{ role: string; content: string }>,
    _taskId:   string,
    onChunk:   (chunk: string) => void,
  ) => doStream('/chat/stream', message, sessionId, history, { onChunk }),

  // Web-augmented stream — RAG phase runs first, then model
  streamChatWeb: (
    message:        string,
    sessionId:      string,
    history:        Array<{ role: string; content: string }>,
    onChunk:        (chunk: string) => void,
    onRagStatus?:   (status: string) => void,
    onRagSources?:  (sources: RAGSource[]) => void,
  ) => doStream('/chat/stream/web', message, sessionId, history, { onChunk, onRagStatus, onRagSources }),

  createProject: (name: string, rootPath: string) =>
    req<any>('POST', '/projects', { name, rootPath }),
  createAgent:   (projectId: string, name: string, role: string, allowedPaths: string[] = []) =>
    req<any>('POST', `/projects/${projectId}/agents`, { name, role, allowedPaths }),
  instruct:      (projectId: string, agentId: string, instruction: string) =>
    req<any>('POST', `/projects/${projectId}/agents/${agentId}/instruct`, { instruction, queue: true }),
}
