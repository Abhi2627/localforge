const BASE = '/api'

async function req<T>(method: string, path: string, body?: object): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`API ${method} ${path} failed (${res.status}): ${err}`)
  }
  return res.json()
}

export const api = {
  // Models
  getModels:      () => req<{ models: any[] }>('GET', '/models'),
  selectModel:    (model: string) => req<any>('POST', '/models/select', { model }),

  // System
  getSystem:      () => req<any>('GET', '/system'),

  // Sessions — persistent history
  getSessions:    () => req<{ sessions: any[] }>('GET', '/sessions'),
  getSession:     (id: string) => req<{ session: any; messages: any[] }>('GET', `/sessions/${id}`),
  createSession:  (id: string, type: string, title: string, rootPath?: string, modelName?: string) =>
    req<any>('POST', '/sessions', { id, type, title, rootPath, modelName }),
  deleteSession:  (id: string) => req<any>('DELETE', `/sessions/${id}`),
  saveMessage:    (id: string, sessionId: string, role: string, content: string, agentName?: string) =>
    req<any>('POST', '/sessions/message', { id, sessionId, role, content, agentName }),

  // Project open — scan + summary
  openProject: (sessionId: string, rootPath: string) =>
    req<{ success: boolean; isEmpty: boolean; fileList: string[]; fileTree: string; fileCount: number }>(
      'POST', '/project/open', { sessionId, rootPath }
    ),
  getProjectSummary: (sessionId: string) =>
    req<{ summary: string | null }>('GET', `/project/${sessionId}/summary`),

  // Chat (conversational)
  sendChat: (message: string, sessionId: string, history: any[] = []) =>
    req<{ success: boolean; reply: string }>('POST', '/chat', { message, sessionId, history }),

  // Agent instructions
  createProject: (name: string, rootPath: string) =>
    req<any>('POST', '/projects', { name, rootPath }),
  createAgent: (projectId: string, name: string, role: string, allowedPaths: string[] = []) =>
    req<any>('POST', `/projects/${projectId}/agents`, { name, role, allowedPaths }),
  instruct: (projectId: string, agentId: string, instruction: string) =>
    req<any>('POST', `/projects/${projectId}/agents/${agentId}/instruct`, { instruction, queue: true }),
}
