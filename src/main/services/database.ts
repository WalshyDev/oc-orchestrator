import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { randomUUID } from 'crypto'

export interface Project {
  id: string
  name: string
  repo_root: string
  created_at: string
  updated_at: string
}

export interface EventRecord {
  id: number
  runtime_id: string
  event_type: string
  event_data: string | null
  created_at: string
}

export interface CustomLabelRow {
  id: string
  name: string
  color_key: string
  created_at: string
}

let db: SqlJsDatabase | null = null
let dbPath = ''
let saveTimer: ReturnType<typeof setTimeout> | null = null

const SAVE_DEBOUNCE_MS = 500

function getDbPath(): string {
  if (dbPath) return dbPath
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  dbPath = join(dir, 'oc-orchestrator.db')
  return dbPath
}

function saveToDisk(): void {
  if (!db) return
  const data = db.export()
  writeFileSync(getDbPath(), Buffer.from(data))
}

function debouncedSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveToDisk, SAVE_DEBOUNCE_MS)
}

function getDb(): SqlJsDatabase {
  if (!db) throw new Error('Database not initialized — call database.init() first')
  return db
}

function readCurrentRow<T>(statement: ReturnType<SqlJsDatabase['prepare']>): T {
  const columns = statement.getColumnNames()
  const values = statement.get()
  const row = {} as Record<string, unknown>

  for (let idx = 0; idx < columns.length; idx++) {
    row[columns[idx]] = values[idx]
  }

  return row as T
}

class Database {
  private initialized = false

  async init(): Promise<void> {
    if (this.initialized) return

    const SQL = await initSqlJs()
    const path = getDbPath()

    if (existsSync(path)) {
      const fileBuffer = readFileSync(path)
      db = new SQL.Database(fileBuffer)
    } else {
      db = new SQL.Database()
    }

    db.run('PRAGMA journal_mode = WAL')
    db.run('PRAGMA foreign_keys = ON')

    this.migrate()
    this.initialized = true
  }

  private migrate(): void {
    const sqlDb = getDb()

    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        repo_root TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)

    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workspace_root TEXT NOT NULL,
        branch_name TEXT,
        status TEXT DEFAULT 'ready',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)

    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS agent_runtimes (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        workspace_id TEXT,
        session_id TEXT,
        process_id INTEGER,
        server_url TEXT,
        status TEXT,
        derived_status TEXT,
        task_summary TEXT,
        model TEXT,
        last_activity_at TEXT,
        blocked_since TEXT,
        cost REAL DEFAULT 0,
        tokens_input INTEGER DEFAULT 0,
        tokens_output INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)

    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        runtime_id TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL
      )
    `)

    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS runtime_health (
        id TEXT PRIMARY KEY,
        runtime_id TEXT NOT NULL,
        healthy INTEGER NOT NULL,
        checked_at TEXT NOT NULL
      )
    `)

    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        runtime_id TEXT,
        event_type TEXT NOT NULL,
        event_data TEXT,
        created_at TEXT NOT NULL
      )
    `)

    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `)

    sqlDb.run(`
      CREATE TABLE IF NOT EXISTS custom_labels (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        color_key TEXT NOT NULL DEFAULT 'blue',
        created_at TEXT NOT NULL
      )
    `)

    saveToDisk()
  }

  private queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
    const sqlDb = getDb()
    const statement = sqlDb.prepare(sql)
    statement.bind(params)

    if (!statement.step()) {
      statement.free()
      return undefined
    }

    const row = readCurrentRow<T>(statement)
    statement.free()
    return row
  }

  private queryAll<T>(sql: string, params: unknown[] = []): T[] {
    const sqlDb = getDb()
    const statement = sqlDb.prepare(sql)
    statement.bind(params)
    const results: T[] = []

    while (statement.step()) {
      results.push(readCurrentRow<T>(statement))
    }

    statement.free()
    return results
  }

  private execute(sql: string, params: unknown[] = []): void {
    const sqlDb = getDb()
    sqlDb.run(sql, params)
    debouncedSave()
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  createProject(name: string, repoRoot: string): Project {
    const now = new Date().toISOString()
    const projectId = randomUUID()
    this.execute(
      'INSERT INTO projects (id, name, repo_root, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [projectId, name, repoRoot, now, now]
    )
    return this.getProject(projectId)!
  }

  getProject(projectId: string): Project | undefined {
    return this.queryOne<Project>('SELECT * FROM projects WHERE id = ?', [projectId])
  }

  getProjectByRepoRoot(repoRoot: string): Project | undefined {
    return this.queryOne<Project>('SELECT * FROM projects WHERE repo_root = ?', [repoRoot])
  }

  getAllProjects(): Project[] {
    return this.queryAll<Project>('SELECT * FROM projects ORDER BY updated_at DESC')
  }

  ensureProject(name: string, repoRoot: string): Project {
    const existing = this.getProjectByRepoRoot(repoRoot)
    if (existing) {
      const now = new Date().toISOString()
      this.execute(
        'UPDATE projects SET name = ?, updated_at = ? WHERE id = ?',
        [name, now, existing.id]
      )
      return this.getProject(existing.id)!
    }
    return this.createProject(name, repoRoot)
  }

  deleteProject(projectId: string): boolean {
    if (!this.getProject(projectId)) return false
    this.execute('DELETE FROM projects WHERE id = ?', [projectId])
    return true
  }

  // ---------------------------------------------------------------------------
  // Preferences
  // ---------------------------------------------------------------------------

  getPreference(key: string): string | undefined {
    const row = this.queryOne<{ value: string }>('SELECT value FROM preferences WHERE key = ?', [key])
    return row?.value
  }

  setPreference(key: string, value: string): void {
    this.execute(
      'INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value]
    )
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  logEvent(runtimeId: string | null, eventType: string, eventData?: string): void {
    const now = new Date().toISOString()
    this.execute(
      'INSERT INTO events (runtime_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)',
      [runtimeId, eventType, eventData ?? null, now]
    )
  }

  getRecentEvents(limit: number = 100): EventRecord[] {
    return this.queryAll<EventRecord>('SELECT * FROM events ORDER BY created_at DESC LIMIT ?', [limit])
  }

  // ---------------------------------------------------------------------------
  // Custom Labels
  // ---------------------------------------------------------------------------

  getAllCustomLabels(): CustomLabelRow[] {
    return this.queryAll<CustomLabelRow>('SELECT * FROM custom_labels ORDER BY created_at ASC')
  }

  createCustomLabel(id: string, name: string, colorKey: string): CustomLabelRow {
    const now = new Date().toISOString()
    this.execute(
      'INSERT INTO custom_labels (id, name, color_key, created_at) VALUES (?, ?, ?, ?)',
      [id, name, colorKey, now]
    )
    return this.queryOne<CustomLabelRow>('SELECT * FROM custom_labels WHERE id = ?', [id])!
  }

  updateCustomLabel(id: string, name: string, colorKey: string): CustomLabelRow | undefined {
    this.execute(
      'UPDATE custom_labels SET name = ?, color_key = ? WHERE id = ?',
      [name, colorKey, id]
    )
    return this.queryOne<CustomLabelRow>('SELECT * FROM custom_labels WHERE id = ?', [id])
  }

  deleteCustomLabel(id: string): boolean {
    const existing = this.queryOne<CustomLabelRow>('SELECT * FROM custom_labels WHERE id = ?', [id])
    if (!existing) return false
    this.execute('DELETE FROM custom_labels WHERE id = ?', [id])
    return true
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  close(): void {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (db) {
      saveToDisk()
      db.close()
      db = null
    }
  }
}

export const database = new Database()
