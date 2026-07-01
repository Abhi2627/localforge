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
      return
    }
    // Pipeline finished — post ONE clean summary message (no raw output dump).
    if (data.type === 'orchestration_done' && data.projectId) {
      const st    = useAppStore.getState()
      const sess  = st.sessions.find(s => s.id === data.projectId)
      const root  = sess?.rootPath ?? ''
      const files = sess?.writtenFiles ?? []
      const rel   = (f: string) => (root && f.startsWith(root)) ? f.slice(root.length).replace(/^\//, '') : f
      const list  = files.length ? files.slice(0, 60).map(f => `- \`${rel(f)}\``).join('\n') : '_(no files reported)_'
      const summary = `Build complete — ${files.length} file${files.length !== 1 ? 's' : ''} written.\n\n${list}\n\nReview the changes in the Explorer and Source Control panels.`
      st.addMessage(data.projectId, { id: `orch-done-${Date.now()}`, type: 'agent', content: summary, timestamp: Date.now() })
      return
    }
    if (data.type === 'phase_started' || data.type === 'phase_done' || data.type === 'orchestration_started') {
      return  // progress events — reflected live in the "building" indicator
    }
    if (data.type !== 'agent_event') return
    const { projectId: sessionId, event } = data
    switch (event.type) {
      case 'stream_chunk':
        // Raw model output (file contents, FILE_WRITTEN markers) is NOT dumped into
        // the chat. Progress is surfaced via the status/file_written events below.
        break
      case 'task_done':
        updateAgent(sessionId, event.agentId, { status: 'idle', currentTask: undefined }); break
      case 'task_failed':
        updateAgent(sessionId, event.agentId, { status: 'failed', currentTask: undefined }); break
      case 'status':
        updateAgent(sessionId, event.agentId, { status: 'running', currentTask: event.message }); break
      case 'file_written':
        if (event.filePath) addWrittenFile(sessionId, event.filePath)
        updateAgent(sessionId, event.agentId, { status: 'running', currentTask: `Writing ${event.filePath ? event.filePath.split('/').pop() : '…'}` }); break
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
