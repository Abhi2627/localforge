import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'

// Must be absolute — Tauri webview doesn't use Vite's proxy
const WS_URL = 'ws://localhost:3001/ws'

export function useWebSocket() {
  const ws             = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const {
    setConnected, appendStream, finalizeStream,
    updateAgent, addWrittenFile, setSessionSummary, setAllFiles,
  } = useAppStore()

  function connect() {
    if (ws.current?.readyState === WebSocket.OPEN) return
    const socket = new WebSocket(WS_URL)
    ws.current = socket

    socket.onopen  = () => {
      setConnected(true)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
    socket.onclose = () => {
      setConnected(false)
      reconnectTimer.current = setTimeout(connect, 2000)
    }
    socket.onerror = () => socket.close()
    socket.onmessage = (e) => {
      try { handleMessage(JSON.parse(e.data)) } catch { }
    }
  }

  function handleMessage(data: any) {
    // Project file scan results broadcast after openProject
    if (data.type === 'project_files') {
      if (data.sessionId && data.fileList?.length) {
        setAllFiles(data.sessionId, data.fileList)
      }
      return
    }

    // AI-generated project summary
    if (data.type === 'project_summary') {
      if (data.sessionId && data.summary) {
        setSessionSummary(data.sessionId, data.summary)
      }
      return
    }

    if (data.type !== 'agent_event') return
    const { projectId: sessionId, event } = data

    switch (event.type) {
      case 'stream_chunk':
        if (event.taskId) appendStream(sessionId, event.taskId, event.message)
        break
      case 'task_done':
        if (event.taskId) finalizeStream(sessionId, event.taskId)
        updateAgent(sessionId, event.agentId, { status: 'idle', currentTask: undefined })
        break
      case 'task_failed':
        if (event.taskId) finalizeStream(sessionId, event.taskId)
        updateAgent(sessionId, event.agentId, { status: 'failed', currentTask: undefined })
        break
      case 'status':
        updateAgent(sessionId, event.agentId, { status: 'running', currentTask: event.message })
        break
      case 'file_written':
        if (event.filePath) addWrittenFile(sessionId, event.filePath)
        updateAgent(sessionId, event.agentId, { currentTask: event.message })
        break
    }
  }

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      ws.current?.close()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
