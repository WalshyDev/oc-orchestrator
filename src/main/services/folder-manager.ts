import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { database } from './database'
import type { AgentFolder, FolderSnapshot } from '../../shared/folders'

const PREFERENCE_KEY = 'fleet.folders'

interface StoredFolders extends FolderSnapshot {
  migrated?: boolean
  membershipChanges?: string[]
}

export class FolderError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message)
  }
}

function readState(): StoredFolders {
  const raw = database.getPreference(PREFERENCE_KEY)
  return raw ? JSON.parse(raw) : { folders: [], membership: {} }
}

function saveState(state: StoredFolders): FolderSnapshot {
  database.setPreference(PREFERENCE_KEY, JSON.stringify(state))
  const snapshot = { folders: state.folders, membership: state.membership }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('folders:changed', snapshot)
  }
  return snapshot
}

function validateName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) {
    throw new FolderError(400, 'bad_request', 'name must be a non-empty string')
  }
  return name.trim()
}

export const folderManager = {
  getSnapshot(): FolderSnapshot {
    const { folders, membership } = readState()
    return { folders, membership }
  },

  migrateLegacy(legacy: FolderSnapshot): FolderSnapshot {
    const state = readState()
    if (state.migrated) return this.getSnapshot()
    const folders = new Map(state.folders.map((folder) => [folder.id, folder]))
    for (const folder of legacy.folders ?? []) {
      if (typeof folder?.id !== 'string' || !folder.id || typeof folder.name !== 'string') continue
      if (!folders.has(folder.id)) {
        folders.set(folder.id, { ...folder, sortOrder: Number.isFinite(folder.sortOrder) ? folder.sortOrder : folders.size })
      }
    }
    state.folders = [...folders.values()]
    const changedAgents = new Set(state.membershipChanges)
    for (const [agentId, folderId] of Object.entries(legacy.membership ?? {})) {
      if (typeof folderId === 'string' && folders.has(folderId) && !changedAgents.has(agentId) && !Object.prototype.hasOwnProperty.call(state.membership, agentId)) {
        state.membership[agentId] = folderId
      }
    }
    state.migrated = true
    delete state.membershipChanges
    return saveState(state)
  },

  requireFolder(folderId: unknown): AgentFolder {
    if (typeof folderId !== 'string' || !folderId) {
      throw new FolderError(400, 'bad_request', 'folderId must be a non-empty string')
    }
    const folder = readState().folders.find((item) => item.id === folderId)
    if (!folder) throw new FolderError(404, 'folder_not_found', `Unknown folder: ${folderId}`)
    return folder
  },

  create(name: unknown): AgentFolder {
    const trimmed = validateName(name)
    const state = readState()
    const folder = { id: randomUUID(), name: trimmed, sortOrder: state.folders.length }
    state.folders.push(folder)
    saveState(state)
    return folder
  },

  rename(folderId: string, name: unknown): AgentFolder {
    const trimmed = validateName(name)
    this.requireFolder(folderId)
    const state = readState()
    const folder = state.folders.find((item) => item.id === folderId)!
    folder.name = trimmed
    saveState(state)
    return folder
  },

  delete(folderId: string): void {
    this.requireFolder(folderId)
    const state = readState()
    state.folders = state.folders.filter((folder) => folder.id !== folderId)
    for (const [agentId, id] of Object.entries(state.membership)) {
      if (id === folderId) delete state.membership[agentId]
    }
    saveState(state)
  },

  getAgentFolder(agentId: string): AgentFolder | null {
    const state = readState()
    return state.folders.find((folder) => folder.id === state.membership[agentId]) ?? null
  },

  setAgentFolder(agentId: string, folderId: unknown): void {
    const folder = folderId === null ? null : this.requireFolder(folderId)
    const state = readState()
    if (folder === null) delete state.membership[agentId]
    else state.membership[agentId] = folder.id
    if (!state.migrated) state.membershipChanges = [...new Set([...(state.membershipChanges ?? []), agentId])]
    saveState(state)
  }
}
