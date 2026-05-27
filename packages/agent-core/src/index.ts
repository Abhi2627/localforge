import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { getDb, closeDb } from './persistence/Database.js'
import { profileSystem } from './orchestrator/SystemProfiler.js'
import { TaskQueue } from './orchestrator/TaskQueue.js'
import {
  getInstalledModels,
  selectModel,
  setFallbackModels,
  loadConfig,
  saveConfig
} from './ollama/ModelManager.js'

const server = Fastify({ logger: true })

let taskQueue: TaskQueue

async function bootstrap() {
  await server.register(cors, { origin: true })
  await server.register(websocket)

  // Profile system and set queue mode
  const profile = await profileSystem()
  const config = loadConfig()

  // User config overrides auto-detection if explicitly set
  const mode = config.executionMode ?? profile.recommendedMode
  const maxParallel = config.maxParallel ?? profile.recommendedMaxParallel
  taskQueue = new TaskQueue(mode, maxParallel)

  // Initialize DB
  getDb()
  console.log('[Server] Database initialized')

  // ── Health ────────────────────────────────────────────────────────────────
  server.get('/health', async () => ({
    status: 'ok',
    mode: taskQueue.currentMode,
    pending: taskQueue.pendingCount,
    running: taskQueue.runningCount
  }))

  // ── System ────────────────────────────────────────────────────────────────
  server.get('/system', async () => {
    return await profileSystem()
  })

  server.post<{ Body: { mode: 'sequential' | 'parallel'; maxParallel?: number } }>(
    '/system/mode',
    async (req) => {
      const { mode, maxParallel } = req.body
      taskQueue.setMode(mode, maxParallel)
      saveConfig({ executionMode: mode, maxParallel: maxParallel ?? 1 })
      return { success: true, mode, maxParallel }
    }
  )

  // ── Models ────────────────────────────────────────────────────────────────

  // List all locally installed Ollama models
  server.get('/models', async () => {
    try {
      const models = await getInstalledModels()
      return { models }
    } catch {
      return server.httpErrors?.createError(503, 'Ollama not reachable. Is it running?')
        ?? { error: 'Ollama not reachable. Run: ollama serve' }
    }
  })

  // Get current selected model + config
  server.get('/models/config', async () => {
    return loadConfig()
  })

  // Select a model as the active model
  server.post<{ Body: { model: string } }>(
    '/models/select',
    async (req) => {
      const { model } = req.body
      if (!model) return { success: false, message: 'model field is required' }
      return await selectModel(model)
    }
  )

  // Set fallback model chain
  server.post<{ Body: { models: string[] } }>(
    '/models/fallback',
    async (req) => {
      const { models } = req.body
      if (!Array.isArray(models)) return { success: false, message: 'models must be an array' }
      const config = await setFallbackModels(models)
      return { success: true, config }
    }
  )

  const PORT = Number(process.env.PORT ?? 3001)
  await server.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`[Server] LocalForge agent server running on port ${PORT}`)
  console.log(`[Server] Active model: ${loadConfig().selectedModel}`)
}

process.on('SIGINT', async () => {
  console.log('[Server] Shutting down...')
  await server.close()
  closeDb()
  process.exit(0)
})

bootstrap().catch(err => {
  console.error('[Server] Fatal error during startup:', err)
  process.exit(1)
})
