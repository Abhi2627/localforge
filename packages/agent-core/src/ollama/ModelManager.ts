import { listModels, isModelAvailable } from '../ollama/OllamaClient.js'
import { getStats, avgLatency, avgTps } from '../ollama/ModelMetrics.js'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CONFIG_PATH = path.join(os.homedir(), '.localforge', 'config.json')

export interface LocalForgeConfig {
  selectedModel:  string
  fallbackModels: string[]
  executionMode:  'sequential' | 'parallel'
  maxParallel:    number
}

const DEFAULT_CONFIG: LocalForgeConfig = {
  selectedModel:  'qwen2.5-coder:latest',
  fallbackModels: [],
  executionMode:  'sequential',
  maxParallel:    1,
}

export function loadConfig(): LocalForgeConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
    }
  } catch {
    console.warn('[Config] Failed to load config, using defaults')
  }
  return { ...DEFAULT_CONFIG }
}

export function saveConfig(config: Partial<LocalForgeConfig>): LocalForgeConfig {
  const current = loadConfig()
  const updated = { ...current, ...config }
  const dir = path.dirname(CONFIG_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2))
  return updated
}

export interface ModelInfo {
  name:        string
  sizeGb:      string
  sizeBytes:   number
  modifiedAt:  string
  isSelected:  boolean
  isFallback:  boolean
  // Runtime metrics (from ModelMetrics)
  totalCalls:    number
  avgLatencyMs:  number
  avgTps:        number
  lastLatencyMs: number
  lastTps:       number
  errorCount:    number
  lastUsed:      number
  // Ollama metadata
  paramSize?:    string
  quantization?: string
  family?:       string
  // Suggestion tags
  tags:          string[]  // e.g. ['code', 'fast', 'large']
}

function tagModel(name: string, sizeBytes: number): string[] {
  const tags: string[] = []
  const n = name.toLowerCase()

  // Task type
  if (n.includes('coder') || n.includes('code') || n.includes('deepseek'))    tags.push('code')
  if (n.includes('chat') || n.includes('llama') || n.includes('mistral'))     tags.push('chat')
  if (n.includes('instruct'))                                                   tags.push('instruct')
  if (n.includes('vision') || n.includes('llava'))                             tags.push('vision')
  if (n.includes('embed'))                                                      tags.push('embedding')
  if (n.includes('math') || n.includes('qwq') || n.includes('deepthink'))      tags.push('reasoning')

  // Size
  const gb = sizeBytes / 1024 / 1024 / 1024
  if (gb < 3)       tags.push('fast')
  else if (gb < 8)  tags.push('balanced')
  else              tags.push('large')

  return tags
}

function suggestModel(models: ModelInfo[], task: 'code' | 'chat' | 'reasoning'): string | null {
  const eligible = models.filter(m => m.tags.includes(task))
  if (eligible.length === 0) return null

  // Rank: prefer models with good TPS and low error rate
  return eligible.sort((a, b) => {
    const scoreA = a.avgTps - a.errorCount * 10
    const scoreB = b.avgTps - b.errorCount * 10
    return scoreB - scoreA
  })[0].name
}

export async function getInstalledModels(): Promise<ModelInfo[]> {
  const config  = loadConfig()
  const models  = await listModels()
  const metrics = getStats()
  const metricMap = Object.fromEntries(metrics.map(m => [m.name, m]))

  return models.map(m => {
    const stat  = metricMap[m.name]
    const tags  = tagModel(m.name, m.size)
    return {
      name:         m.name,
      sizeGb:       (m.size / 1024 / 1024 / 1024).toFixed(1) + ' GB',
      sizeBytes:    m.size,
      modifiedAt:   m.modified_at,
      isSelected:   m.name === config.selectedModel,
      isFallback:   config.fallbackModels.includes(m.name),
      totalCalls:   stat?.totalCalls    ?? 0,
      avgLatencyMs: stat ? avgLatency(stat) : 0,
      avgTps:       stat ? avgTps(stat)     : 0,
      lastLatencyMs:stat?.lastLatencyMs ?? 0,
      lastTps:      stat?.lastTps       ?? 0,
      errorCount:   stat?.errors.length ?? 0,
      lastUsed:     stat?.lastUsed      ?? 0,
      paramSize:    m.details?.parameter_size,
      quantization: m.details?.quantization_level,
      family:       m.details?.family,
      tags,
    }
  })
}

export async function getModelStats() {
  const config  = loadConfig()
  const models  = await getInstalledModels()
  const metrics = getStats()

  return {
    models,
    selected:   config.selectedModel,
    fallbacks:  config.fallbackModels,
    errors:     metrics.flatMap(m => m.errors.map(e => ({ model: m.name, ...e }))).sort((a, b) => b.ts - a.ts).slice(0, 50),
    suggestions: {
      code:      suggestModel(models, 'code'),
      chat:      suggestModel(models, 'chat'),
      reasoning: suggestModel(models, 'reasoning'),
    },
  }
}

export async function selectModel(modelName: string): Promise<{ success: boolean; message: string }> {
  const available = await isModelAvailable(modelName)
  if (!available) return { success: false, message: `Model "${modelName}" is not installed. Run: ollama pull ${modelName}` }
  saveConfig({ selectedModel: modelName })
  return { success: true, message: `Model set to ${modelName}` }
}

export async function setFallbackModels(models: string[]): Promise<LocalForgeConfig> {
  return saveConfig({ fallbackModels: models })
}
