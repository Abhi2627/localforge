import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'

const WS_URL = 'ws://localhost:3001/ws'

export function useWebSocket() {
  const ws             = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef     = useRef(false)
  const {
    setConnected, setOnline,
    updateAgent, addAgent, addWrittenFile, setSessionSummary, setAllFiles,
  } = useAppStore()

  function updateOnlineStatus() {
    setOnline(navigator.onLine)
  }

  function connect() {
    if (!mountedRef.current) return
    if (ws.current?.readyState === WebSocket.OPEN) return
    if (ws.current?.readyState === WebSocket.CONNECTING) return

    const socket = new WebSocket(WS_URL)
    ws.current = socket

    socket.onopen = () => {
      if (!mountedRef.current) { socket.close(); return }
      setConnected(true)
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null }
    }
    socket.onclose = () => {
      setConnected(false)
      if (mountedRef.current) reconnectTimer.current = setTimeout(connect, 2500)
    }
    socket.onerror = () => socket.close()
    socket.onmessage = (e) => {
      try { handleMessage(JSON.parse(e.data)) } catch { }
    }
  }

  function handleMessage(data: any) {
    if (data.type === 'project_files') {
      if (data.sessionId && data.fileList?.length) setAllFiles(data.sessionId, data.fileList)
      return
    }
    if (data.type === 'project_summary') {
      if (data.sessionId && data.summary) setSessionSummary(data.sessionId, data.summary)
      return
    }
    // Orchestration pipeline: an agent was just deployed for a phase — add it to the
    // panel so its progress (status/file_written events) has something to update.
    if (data.type === 'agent_deployed' && data.projectId && data.agent?.id) {
      addAgent(data.projectId, { id: data.agent.id, name: data.agent.name, role: data.agent.role, status: 'running', currentTask: data.agent.phase ? `Phase: ${data.agent.phase}` : undefined })
      useAppStore.getState().pipelineDeployAgent(data.projectId, data.agent.phase ?? '', data.agent.id, data.agent.name, data.agent.role)
      return
    }
    // Verify/fix progress (install → build → tests) — shown as a live pipeline status.
    if (data.type === 'verify_status' && data.projectId) {
      const st = useAppStore.getState()
      st.setPipelineStatus(data.projectId, data.message ?? null)
      if (data.message) st.pipelineLog(data.projectId, data.message)
      return
    }
    // Deploy check progress (starting app → waiting for port → up/down).
    if (data.type === 'deploy_status' && data.projectId) {
      const st = useAppStore.getState()
      st.setPipelineStatus(data.projectId, data.message ?? null)
      if (data.message) st.pipelineLog(data.projectId, data.message)
      return
    }
    // State-aware planner decided nothing needed building.
    if (data.type === 'orchestration_skipped' && data.projectId) {
      const st = useAppStore.getState()
      st.addMessage(data.projectId, { id: `orch-skip-${Date.now()}`, type: 'agent', content: `✓ Nothing to build — ${data.note ?? 'this already exists in the project.'}`, timestamp: Date.now() })
      return
    }
    // Pipeline finished — post ONE clean summary message (no raw output dump).
    if (data.type === 'orchestration_done' && data.projectId) {
      const st    = useAppStore.getState()
      st.setPipelineStatus(data.projectId, null)
      st.settleAgents(data.projectId)   // clear any agent still stuck on 'running'
      st.pipelineFinish(data.projectId, { verify: data.verify, deploy: data.deploy })
      // Collapse the live panel shortly after — its result lives on in the summary message below.
      setTimeout(() => useAppStore.getState().pipelineClear(data.projectId), 1200)
      const sess  = st.sessions.find(s => s.id === data.projectId)
      const root  = sess?.rootPath ?? ''
      const files = sess?.writtenFiles ?? []
      const rel   = (f: string) => (root && f.startsWith(root)) ? f.slice(root.length).replace(/^\//, '') : f
      const list  = files.length ? files.slice(0, 60).map(f => `- \`${rel(f)}\``).join('\n') : '_(no files reported)_'
      const v = data.verify
      const verifyLine = !v ? ''
        : v.skipped ? '\n\n_No verifiable build detected — skipped verification._'
        : v.ok      ? '\n\n✅ **Verified** — install/build/tests passed.'
        :             `\n\n⚠️ **Verification failed** at "${v.failed ?? 'a step'}" after auto-fix attempts. Check the terminal output.`
      const d = data.deploy
      const deployLine = !d || d.status === 'skipped' ? ''
        : d.status === 'up'   ? `\n\n🚀 **Deploy check passed** — app came up on port ${d.port ?? '?'}.`
        :                       `\n\n⚠️ **Deploy check failed** — app did not open port ${d.port ?? '?'}. Check the terminal output.`
      const summary = `Build complete — ${files.length} file${files.length !== 1 ? 's' : ''} written.\n\n${list}${verifyLine}${deployLine}\n\nReview the changes in the Explorer and Source Control panels.`
      st.addMessage(data.projectId, { id: `orch-done-${Date.now()}`, type: 'agent', content: summary, timestamp: Date.now() })
      return
    }
    if (data.type === 'orchestration_started' && data.projectId) {
      // Fresh run — drop any zombie agents from a previous crashed/hung build
      // before this run's agents deploy via 'agent_deployed'.
      const st = useAppStore.getState()
      st.resetAgents(data.projectId)
      st.pipelineStart(data.projectId, data.task ?? '', Array.isArray(data.phases) ? data.phases : [])
      return
    }
    if (data.type === 'phase_started' && data.projectId) {
      useAppStore.getState().pipelinePhase(data.projectId, data.phase, 'running'); return
    }
    if (data.type === 'phase_done' && data.projectId) {
      useAppStore.getState().pipelinePhase(data.projectId, data.phase, 'done'); return
    }
    if (data.type !== 'agent_event') return
    const { projectId: sessionId, event } = data
    const pipe = useAppStore.getState()
    switch (event.type) {
      case 'stream_chunk':
        // Raw model output (file contents, FILE_WRITTEN markers) is NOT dumped into
        // the chat. Progress is surfaced via the status/file_written events below.
        break
      case 'task_done':
        updateAgent(sessionId, event.agentId, { status: 'idle', currentTask: undefined })
        pipe.pipelineAgent(sessionId, event.agentId, { status: 'done', task: undefined }); break
      case 'task_failed':
        updateAgent(sessionId, event.agentId, { status: 'failed', currentTask: undefined })
        pipe.pipelineAgent(sessionId, event.agentId, { status: 'failed', task: undefined }); break
      case 'status':
        updateAgent(sessionId, event.agentId, { status: 'running', currentTask: event.message })
        pipe.pipelineAgent(sessionId, event.agentId, { status: 'running', task: event.message }); break
      case 'file_written':
        if (event.filePath) addWrittenFile(sessionId, event.filePath)
        updateAgent(sessionId, event.agentId, { status: 'running', currentTask: `Writing ${event.filePath ? event.filePath.split('/').pop() : '…'}` })
        pipe.pipelineAgent(sessionId, event.agentId, { status: 'running', task: `Writing ${event.filePath ? event.filePath.split('/').pop() : '…'}` }); break
    }
  }

  useEffect(() => {
    mountedRef.current = true

    // Set initial state
    updateOnlineStatus()

    // Listen to native browser online/offline events — fires instantly when network changes
    window.addEventListener('online',  updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)

    // Start WS
    const t = setTimeout(connect, 100)

    return () => {
      mountedRef.current = false
      clearTimeout(t)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      window.removeEventListener('online',  updateOnlineStatus)
      window.removeEventListener('offline', updateOnlineStatus)
      ws.current?.close()
      ws.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
