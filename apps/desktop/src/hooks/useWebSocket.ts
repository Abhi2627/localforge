import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'

const WS_URL = 'ws://localhost:3001/ws'
// A lightweight endpoint to verify actual internet connectivity
// Using a well-known reliable URL (Cloudflare DNS over HTTPS)
const CONNECTIVITY_CHECK_URL = 'https://1.1.1.1/cdn-cgi/trace'

export function useWebSocket() {
  const ws             = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onlineTimer    = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef     = useRef(false)
  const {
    setConnected, setOnline,
    appendStream, finalizeStream,
    updateAgent, addWrittenFile, setSessionSummary, setAllFiles,
  } = useAppStore()

  // ── Real internet check ────────────────────────────────────────────────────
  async function checkOnline() {
    // navigator.onLine is unreliable — it returns true even on captive portals
    // We do a real fetch to confirm actual internet access
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3000)
      const res = await fetch(CONNECTIVITY_CHECK_URL, {
        method: 'HEAD',
        cache:  'no-store',
        signal: controller.signal,
      })
      clearTimeout(timer)
      setOnline(res.ok)
    } catch {
      setOnline(false)
    }
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────
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
    if (data.type !== 'agent_event') return
    const { projectId: sessionId, event } = data
    switch (event.type) {
      case 'stream_chunk':
        if (event.taskId) appendStream(sessionId, event.taskId, event.message); break
      case 'task_done':
        if (event.taskId) finalizeStream(sessionId, event.taskId)
        updateAgent(sessionId, event.agentId, { status: 'idle', currentTask: undefined }); break
      case 'task_failed':
        if (event.taskId) finalizeStream(sessionId, event.taskId)
        updateAgent(sessionId, event.agentId, { status: 'failed', currentTask: undefined }); break
      case 'status':
        updateAgent(sessionId, event.agentId, { status: 'running', currentTask: event.message }); break
      case 'file_written':
        if (event.filePath) addWrittenFile(sessionId, event.filePath)
        updateAgent(sessionId, event.agentId, { currentTask: event.message }); break
    }
  }

  useEffect(() => {
    mountedRef.current = true

    // Initial online check + WS connect
    checkOnline()
    const t = setTimeout(connect, 100)

    // Listen to native online/offline events for instant feedback
    const handleOnline  = () => checkOnline()
    const handleOffline = () => setOnline(false)
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)

    // Periodic connectivity check every 15s — catches wifi-on-but-no-internet
    onlineTimer.current = setInterval(checkOnline, 15000)

    return () => {
      mountedRef.current = false
      clearTimeout(t)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      if (onlineTimer.current)    clearInterval(onlineTimer.current)
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
      ws.current?.close()
      ws.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
