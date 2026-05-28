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
  getModels:     () => req<{ models: any[] }>('GET', '/models'),
  getModelConfig:() => req<any>('GET', '/models/config'),
  selectModel:   (model: string) => req<any>('POST', '/models/select', { model }),

  // System
  getSystem:     () => req<any>('GET', '/system'),
  setMode:       (mode: string, maxParallel?: number) =>
    req<any>('POST', '/system/mode', { mode, maxParallel }),

  // Projects
  getProjects:   () => req<{ projects: any[] }>('GET', '/projects'),
  createProject: (name: string, rootPath: string) =>
    req<any>('POST', '/projects', { name, rootPath }),

  // Agents
  getAgents:     (projectId: string) =>
    req<{ agents: any[] }>('GET', `/projects/${projectId}/agents`),
  createAgent:   (projectId: string, name: string, role: string, allowedPaths: string[] = []) =>
    req<any>('POST', `/projects/${projectId}/agents`, { name, role, allowedPaths }),

  // Instructions
  instruct: (projectId: string, agentId: string, instruction: string) =>
    req<any>('POST', `/projects/${projectId}/agents/${agentId}/instruct`, {
      instruction,
      queue: true
    }),
}
