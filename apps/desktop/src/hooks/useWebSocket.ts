import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'

const WS_URL = 'ws://localhost:3001/ws'

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { setConnected, appendStream, finalizeStream, updateAgent, addWrittenFile, activeProjectId } = useAppStore()

  function connect() {
    if (ws.current?.readyState === WebSocket.OPEN) return

    const socket = new WebSocket(WS_URL)
    ws.current = socket

    socket.onopen = () => {
      setConnected(true)
      console.log('[WS] Connected')
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }

    socket.onclose = () => {
      setConnected(false)
      console.log('[WS] Disconnected — reconnecting in 2s')
      reconnectTimer.current = setTimeout(connect, 2000)
    }

    socket.onerror = () => {
      socket.close()
    }

    socket.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        handleMessage(data)
      } catch {
        // ignore malformed
      }
    }
  }

  function handleMessage(data: any) {
    if (data.type !== 'agent_event') return
    const { projectId, event } = data

    switch (event.type) {
      case 'stream_chunk':
        if (event.taskId) appendStream(projectId, event.taskId, event.message)
        break

      case 'task_done':
        if (event.taskId) finalizeStream(projectId, event.taskId)
        updateAgent(projectId, event.agentId, { status: 'idle', currentTask: undefined })
        break

      case 'task_failed':
        if (event.taskId) finalizeStream(projectId, event.taskId)
        updateAgent(projectId, event.agentId, { status: 'failed', currentTask: undefined })
        break

      case 'status':
        updateAgent(projectId, event.agentId, { status: 'running', currentTask: event.message })
        break

      case 'file_written':
        if (event.filePath) addWrittenFile(projectId, event.filePath)
        updateAgent(projectId, event.agentId, { currentTask: event.message })
        break
    }
  }

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      ws.current?.close()
    }
  }, [])

  return ws
}
