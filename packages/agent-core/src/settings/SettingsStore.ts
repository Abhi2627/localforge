/**
 * SettingsStore.ts — Persistent app settings at ~/.localforge/settings.json
 */

import fs   from 'fs'
import path from 'path'
import os   from 'os'
import type { CloudProvider } from '../cloud/CloudClient.js'

const SETTINGS_PATH = path.join(os.homedir(), '.localforge', 'settings.json')

export interface ApiKeys {
  openai?:    string
  gemini?:    string
  claude?:    string
  groq?:      string
  customKey?: string
  customUrl?: string
}

export interface LLMDefaults {
  temperature:   number
  maxTokens:     number
  systemPrompt:  string
  contextLength: number
}

export interface AppSettings {
  activeProvider: 'ollama' | CloudProvider
  cloudModels:    Partial<Record<CloudProvider, string>>
  apiKeys:        ApiKeys
  llmDefaults:    LLMDefaults
  fontSize:       number
  autoApply:      boolean   // auto-apply agent file patches without confirm dialog
}

const DEFAULTS: AppSettings = {
  activeProvider: 'ollama',
  cloudModels: {
    openai: 'gpt-4o-mini',
    gemini: 'gemini-2.0-flash',
    claude: 'claude-haiku-4-5',
    groq:   'llama-3.3-70b-versatile',
  },
  apiKeys: {},
  llmDefaults: { temperature: 0.7, maxTokens: 4096, systemPrompt: '', contextLength: 4096 },
  fontSize: 13,
  autoApply: false,
}

export function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))
      return {
        ...DEFAULTS, ...parsed,
        cloudModels: { ...DEFAULTS.cloudModels, ...parsed.cloudModels },
        apiKeys:     { ...DEFAULTS.apiKeys,     ...parsed.apiKeys },
        llmDefaults: { ...DEFAULTS.llmDefaults, ...parsed.llmDefaults },
      }
    }
  } catch { console.warn('[Settings] load failed, using defaults') }
  return { ...DEFAULTS }
}

export function saveSettings(update: Partial<AppSettings>): AppSettings {
  const cur = loadSettings()
  const upd: AppSettings = {
    ...cur, ...update,
    cloudModels: { ...cur.cloudModels, ...(update.cloudModels ?? {}) },
    apiKeys:     { ...cur.apiKeys,     ...(update.apiKeys ?? {}) },
    llmDefaults: { ...cur.llmDefaults, ...(update.llmDefaults ?? {}) },
  }
  const dir = path.dirname(SETTINGS_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(upd, null, 2))
  return upd
}

export function getPublicSettings() {
  const s = loadSettings()
  const mask = (k?: string) => k ? '••••' + k.slice(-4) : ''
  return {
    ...s,
    apiKeys: {
      openai:    mask(s.apiKeys.openai),
      gemini:    mask(s.apiKeys.gemini),
      claude:    mask(s.apiKeys.claude),
      groq:      mask(s.apiKeys.groq),
      customKey: mask(s.apiKeys.customKey),
      customUrl: s.apiKeys.customUrl ?? '',
    },
    apiKeyStatus: {
      openai: !!s.apiKeys.openai,
      gemini: !!s.apiKeys.gemini,
      claude: !!s.apiKeys.claude,
      groq:   !!s.apiKeys.groq,
      custom: !!(s.apiKeys.customKey && s.apiKeys.customUrl),
    },
    autoApply: s.autoApply ?? false,
  }
}
