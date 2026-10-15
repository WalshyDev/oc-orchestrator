import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '', failRename: false }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('fs')>()
  return {
    ...fs,
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      if (state.failRename) throw new Error('Rename failed')
      return fs.renameSync(...args)
    }
  }
})

let database: typeof import('../main/services/database').database | undefined

const dbFile = () => join(state.userData, 'oc-orchestrator.db')
// Bytes 18 and 19 of the SQLite header are 2 for WAL and 1 for rollback journals
const journalHeader = () => [...readFileSync(dbFile()).subarray(18, 20)]

async function seedLegacyImage(): Promise<void> {
  const SQL = await initSqlJs()
  const seed = new SQL.Database()
  seed.run('PRAGMA journal_mode = WAL')
  seed.run(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, repo_root TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      workspace_root TEXT NOT NULL, branch_name TEXT, status TEXT DEFAULT 'ready',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO projects VALUES ('project', 'repo', '/repo', 'now', 'now');
    INSERT INTO workspaces (id, project_id, workspace_root, created_at, updated_at)
      VALUES ('workspace', 'project', '/repo', 'now', 'now');
  `)
  writeFileSync(dbFile(), Buffer.from(seed.export()))
  seed.close()
}

async function openDatabase() {
  vi.resetModules()
  database = (await import('../main/services/database')).database
  await database.init()
  return database
}

beforeEach(() => {
  state.userData = mkdtempSync(join(tmpdir(), 'oco-database-'))
})

afterEach(() => {
  state.failRename = false
  database?.close()
  database = undefined
  vi.useRealTimers()
  rmSync(state.userData, { recursive: true, force: true })
})

it('saves rollback journal images that keep foreign keys enforced after each save', async () => {
  await seedLegacyImage()
  chmodSync(dbFile(), 0o600)
  expect(journalHeader()).toEqual([2, 2])
  const inodeBefore = statSync(dbFile()).ino

  const database = await openDatabase()
  expect(journalHeader()).toEqual([1, 1])
  expect(statSync(dbFile()).ino).not.toBe(inodeBefore)
  expect(statSync(dbFile()).mode & 0o777).toBe(0o600)

  vi.useFakeTimers()
  database.setPreference('key', 'value')
  vi.advanceTimersByTime(500)
  const SQL = await initSqlJs()
  const snapshot = new SQL.Database(readFileSync(dbFile()))
  expect(snapshot.exec("SELECT value FROM preferences WHERE key = 'key'")[0].values[0][0]).toBe('value')
  snapshot.close()

  expect(database.deleteProject('project')).toBe(true)
  vi.advanceTimersByTime(500)
  database.close()

  expect(journalHeader()).toEqual([1, 1])
  expect(readdirSync(state.userData)).toEqual(['oc-orchestrator.db'])
  const saved = new SQL.Database(readFileSync(dbFile()))
  expect(saved.exec('SELECT count(*) FROM workspaces')[0].values[0][0]).toBe(0)
  expect(saved.exec("SELECT value FROM preferences WHERE key = 'key'")[0].values[0][0]).toBe('value')
  saved.close()
})

it('keeps the last saved image and removes temporary files when replacement fails', async () => {
  const database = await openDatabase()
  const original = readFileSync(dbFile())
  database.setPreference('key', 'value')
  state.failRename = true
  expect(() => database.close()).toThrow('Rename failed')
  expect(readFileSync(dbFile())).toEqual(original)
  expect(readdirSync(state.userData)).toEqual(['oc-orchestrator.db'])

  state.failRename = false
  database.close()
  const restarted = await openDatabase()
  expect(restarted.getPreference('key')).toBe('value')
  expect(journalHeader()).toEqual([1, 1])
})
