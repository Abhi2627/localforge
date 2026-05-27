import { listModels, isModelAvailable } from '../ollama/OllamaClient.js'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CONFIG_PATH = path.join(os.homedir(), '.localforge', 'config.json')

export interface LocalForgeConfig {
  selectedModel: string
  fallbackModels: string[]
  executionMode: 'sequential' | 'parallel'
  maxParallel: number
}

const DEFAULT_CONFIG: LocalForgeConfig = {
  selectedModel: 'qwen3.5:8b',
  fallbackModels: ['llama3.2:8b', 'gemma3:8b'],
  executionMode: 'sequential',
  maxParallel: 1
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
  name: string
  sizeGb: string
  modifiedAt: string
  isSelected: boolean
  isFallback: boolean
}

export async function getInstalledModels(): Promise<ModelInfo[]> {
  const config = loadConfig()
  const models = await listModels()

  return models.map(m => ({
    name: m.name,
    sizeGb: (m.size / 1024 / 1024 / 1024).toFixed(1) + ' GB',
    modifiedAt: m.modified_at,
    isSelected: m.name === config.selectedModel,
    isFallback: config.fallbackModels.includes(m.name)
  }))
}

export async function selectModel(modelName: string): Promise<{ success: boolean; message: string }> {
  const available = await isModelAvailable(modelName)
  if (!available) {
    return {
      success: false,
      message: `Model "${modelName}" is not installed. Run: ollama pull ${modelName}`
    }
  }
  saveConfig({ selectedModel: modelName })
  return { success: true, message: `Model set to ${modelName}` }
}

export async function setFallbackModels(models: string[]): Promise<LocalForgeConfig> {
  return saveConfig({ fallbackModels: models })
}
