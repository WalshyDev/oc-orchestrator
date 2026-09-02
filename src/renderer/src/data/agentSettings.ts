import { isOutputVerbosity, type OutputVerbosity } from './settings'

export const AGENT_SETTINGS_STORAGE_KEY = 'oc-orchestrator:agent-settings'

interface StoredAgentSettings {
  outputVerbosity?: OutputVerbosity
  autoRecoverStalledResponses?: boolean
}

export type AgentAutoRecoverSetting = 'inherit' | 'on' | 'off'

function loadAllAgentSettings(): Record<string, StoredAgentSettings> {
  try {
    const stored = localStorage.getItem(AGENT_SETTINGS_STORAGE_KEY)
    if (!stored) return {}
    const parsed = JSON.parse(stored) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const result: Record<string, StoredAgentSettings> = {}
    for (const [agentId, settings] of Object.entries(parsed)) {
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) continue
      const storedSettings = settings as Record<string, unknown>
      const outputVerbosity = isOutputVerbosity(storedSettings.outputVerbosity)
        ? storedSettings.outputVerbosity
        : undefined
      const autoRecoverStalledResponses = typeof storedSettings.autoRecoverStalledResponses === 'boolean'
        ? storedSettings.autoRecoverStalledResponses
        : undefined
      if (outputVerbosity === undefined && autoRecoverStalledResponses === undefined) continue
      result[agentId] = { outputVerbosity, autoRecoverStalledResponses }
    }
    return result
  } catch {
    return {}
  }
}

function saveAllAgentSettings(settings: Record<string, StoredAgentSettings>): void {
  try {
    localStorage.setItem(AGENT_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Settings remain usable for the current render when storage is unavailable.
  }
}

export function loadAgentOutputVerbosity(agentId: string): OutputVerbosity | undefined {
  return loadAllAgentSettings()[agentId]?.outputVerbosity
}

export function saveAgentOutputVerbosity(agentId: string, outputVerbosity: OutputVerbosity): void {
  const settings = loadAllAgentSettings()
  settings[agentId] = { ...settings[agentId], outputVerbosity }
  saveAllAgentSettings(settings)
}

export function loadAgentAutoRecoverSetting(agentId: string): AgentAutoRecoverSetting {
  const value = loadAllAgentSettings()[agentId]?.autoRecoverStalledResponses
  if (value === true) return 'on'
  if (value === false) return 'off'
  return 'inherit'
}

export function saveAgentAutoRecoverSetting(agentId: string, value: AgentAutoRecoverSetting): void {
  const settings = loadAllAgentSettings()
  const current = settings[agentId] ?? {}
  if (value === 'inherit') {
    delete current.autoRecoverStalledResponses
  } else {
    current.autoRecoverStalledResponses = value === 'on'
  }
  if (current.outputVerbosity === undefined && current.autoRecoverStalledResponses === undefined) {
    delete settings[agentId]
  } else {
    settings[agentId] = current
  }
  saveAllAgentSettings(settings)
}

export function deleteAgentSettings(agentId: string): void {
  const settings = loadAllAgentSettings()
  delete settings[agentId]
  saveAllAgentSettings(settings)
}

export function resolveAutoRecoverStalledResponses(
  globalDefault: boolean,
  agentSetting: AgentAutoRecoverSetting
): boolean {
  return agentSetting === 'inherit' ? globalDefault : agentSetting === 'on'
}
