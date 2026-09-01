import { isOutputVerbosity, type OutputVerbosity } from './settings'

export const AGENT_SETTINGS_STORAGE_KEY = 'oc-orchestrator:agent-settings'

interface StoredAgentSettings {
  outputVerbosity?: OutputVerbosity
}

function loadAllAgentSettings(): Record<string, StoredAgentSettings> {
  try {
    const stored = localStorage.getItem(AGENT_SETTINGS_STORAGE_KEY)
    if (!stored) return {}
    const parsed = JSON.parse(stored) as Record<string, { outputVerbosity?: unknown }>
    const result: Record<string, StoredAgentSettings> = {}
    for (const [agentId, settings] of Object.entries(parsed)) {
      if (isOutputVerbosity(settings?.outputVerbosity)) {
        result[agentId] = { outputVerbosity: settings.outputVerbosity }
      }
    }
    return result
  } catch {
    return {}
  }
}

export function loadAgentOutputVerbosity(agentId: string): OutputVerbosity | undefined {
  return loadAllAgentSettings()[agentId]?.outputVerbosity
}

export function saveAgentOutputVerbosity(agentId: string, outputVerbosity: OutputVerbosity): void {
  try {
    const settings = loadAllAgentSettings()
    settings[agentId] = { ...settings[agentId], outputVerbosity }
    localStorage.setItem(AGENT_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // The drawer still updates when storage is unavailable.
  }
}
