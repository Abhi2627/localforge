// Use absolute URL so requests work in both Vite browser mode AND Tauri webview.
// In Tauri the webview doesn't go through Vite's proxy, so /api/... would fail.
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

// Streaming chat — reads SSE chunks and calls onChunk for each token
export async function streamChatRequest(
  message:  string,
  sessionId: string,
  history:  Array<{ role: string; content: string }>,
  onChunk:  (chunk: string) => void
): Promise<void> {
  const res = await fetch(`${BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId, history }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Stream failed (${res.status}): ${err}`)
  }

  const reader  = res.body?.getReader()
  const decoder = new TextDecoder()
  if (!reader) throw new Error('No response body')

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text  = decoder.decode(value, { stream: true })
    const lines = text.split('\n').filter(l => l.startsWith('data: '))
    for (const line of lines) {
      const data = line.slice(6).trim()
      if (data === '[DONE]') return
      try {
        const parsed = JSON.parse(data)
        if (parsed.chunk) onChunk(parsed.chunk)
      } catch { }
    }
  }
}

export const api = {
  // Models
  getModels:   () => req<{ models: any[] }>('GET', '/models'),
  selectModel: (model: string) => req<any>('POST', '/models/select', { model }),

  // System
  getSystem: () => req<any>('GET', '/system'),

  // Sessions
  getSessions:   () => req<{ sessions: any[] }>('GET', '/sessions'),
  getSession:    (id: string) => req<{ session: any; messages: any[] }>('GET', `/sessions/${id}`),
  createSession: (id: string, type: string, title: string, rootPath?: string, modelName?: string) =>
    req<any>('POST', '/sessions', { id, type, title, rootPath, modelName }),
  deleteSession: (id: string) => req<any>('DELETE', `/sessions/${id}`),
  saveMessage:   (id: string, sessionId: string, role: string, content: string, agentName?: string) =>
    req<any>('POST', '/sessions/message', { id, sessionId, role, content, agentName }),

  // Project
  openProject:       (sessionId: string, rootPath: string) =>
    req<{ success: boolean; isEmpty: boolean; fileList: string[]; fileTree: string; fileCount: number }>(
      'POST', '/project/open', { sessionId, rootPath }
    ),
  getProjectSummary: (sessionId: string) =>
    req<{ summary: string | null }>('GET', `/project/${sessionId}/summary`),

  // File operations
  readFile:  (filePath: string) =>
    req<{ content: string }>('GET', `/project/file?path=${encodeURIComponent(filePath)}`),
  writeFile: (filePath: string, content: string) =>
    req<{ success: boolean }>('POST', '/project/file', { path: filePath, content }),

  // Chat — non-streaming (title generation only)
  sendChat: (message: string, sessionId: string, history: any[] = []) =>
    req<{ success: boolean; reply: string }>('POST', '/chat', { message, sessionId, history }),

  // Chat — streaming (all real user messages)
  streamChat: (
    message:   string,
    sessionId: string,
    history:   Array<{ role: string; content: string }>,
    _taskId:   string,
    onChunk:   (chunk: string) => void
  ) => streamChatRequest(message, sessionId, history, onChunk),

  // Projects / agents
  createProject: (name: string, rootPath: string) =>
    req<any>('POST', '/projects', { name, rootPath }),
  createAgent: (projectId: string, name: string, role: string, allowedPaths: string[] = []) =>
    req<any>('POST', `/projects/${projectId}/agents`, { name, role, allowedPaths }),
  instruct: (projectId: string, agentId: string, instruction: string) =>
    req<any>('POST', `/projects/${projectId}/agents/${agentId}/instruct`, { instruction, queue: true }),
}
