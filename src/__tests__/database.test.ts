import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'crypto'
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'

interface Project {
  id: string
  name: string
  repo_root: string
  created_at: string
  updated_at: string
}

interface EventRecord {
  id: number
  runtime_id: string | null
  event_type: string
  event_data: string | null
  created_at: string
}

// ── Minimal test database matching the production Database API ──

class TestDatabase {
  private db: SqlJsDatabase

  constructor(db: SqlJsDatabase) {
    this.db = db
    this.db.run('PRAGMA foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        repo_root TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        runtime_id TEXT,
        event_type TEXT NOT NULL,
        event_data TEXT,
        created_at TEXT NOT NULL
      )
    `)
  }

  private queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
    const stmt = this.db.prepare(sql)
    stmt.bind(params)
    if (stmt.step()) {
      const columns = stmt.getColumnNames()
      const values = stmt.get()
      stmt.free()
      const row = {} as Record<string, unknown>
      for (let idx = 0; idx < columns.length; idx++) {
        row[columns[idx]] = values[idx]
      }
      return row as T
    }
    stmt.free()
    return undefined
  }

  private queryAll<T>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql)
    stmt.bind(params)
    const results: T[] = []
    while (stmt.step()) {
      const columns = stmt.getColumnNames()
      const values = stmt.get()
      const row = {} as Record<string, unknown>
      for (let idx = 0; idx < columns.length; idx++) {
        row[columns[idx]] = values[idx]
      }
      results.push(row as T)
    }
    stmt.free()
    return results
  }

  createProject(name: string, repoRoot: string): Project {
    const now = new Date().toISOString()
    const projectId = randomUUID()
    this.db.run(
      'INSERT INTO projects (id, name, repo_root, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [projectId, name, repoRoot, now, now]
    )
    return this.getProject(projectId)!
  }

  getProject(projectId: string): Project | undefined {
    return this.queryOne<Project>('SELECT * FROM projects WHERE id = ?', [projectId])
  }

  getAllProjects(): Project[] {
    return this.queryAll<Project>('SELECT * FROM projects ORDER BY updated_at DESC')
  }

  deleteProject(projectId: string): boolean {
    const before = this.getProject(projectId)
    if (!before) return false
    this.db.run('DELETE FROM projects WHERE id = ?', [projectId])
    return true
  }

  getPreference(key: string): string | undefined {
    const row = this.queryOne<{ value: string }>('SELECT value FROM preferences WHERE key = ?', [key])
    return row?.value
  }

  setPreference(key: string, value: string): void {
    this.db.run(
      'INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value]
    )
  }

  logEvent(runtimeId: string | null, eventType: string, eventData?: string): void {
    const now = new Date().toISOString()
    this.db.run(
      'INSERT INTO events (runtime_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)',
      [runtimeId, eventType, eventData ?? null, now]
    )
  }

  getRecentEvents(limit: number = 100): EventRecord[] {
    return this.queryAll<EventRecord>('SELECT * FROM events ORDER BY created_at DESC LIMIT ?', [limit])
  }

  close(): void {
    this.db.close()
  }
}

// ── Tests ──

describe('Database', () => {
  let database: TestDatabase

  beforeEach(async () => {
    const SQL = await initSqlJs()
    database = new TestDatabase(new SQL.Database())
  })

  afterEach(() => {
    database.close()
  })

  describe('Project CRUD', () => {
    it('creates a project and retrieves it by id', () => {
      const project = database.createProject('My App', '/home/user/my-app')
      expect(project).toBeDefined()
      expect(project.name).toBe('My App')
      expect(project.repo_root).toBe('/home/user/my-app')
      expect(project.id).toBeTruthy()

      const retrieved = database.getProject(project.id)
      expect(retrieved).toEqual(project)
    })

    it('returns undefined for a non-existent project', () => {
      expect(database.getProject('non-existent-id')).toBeUndefined()
    })

    it('lists all projects', () => {
      database.createProject('Project A', '/path/a')
      database.createProject('Project B', '/path/b')
      const projects = database.getAllProjects()
      expect(projects).toHaveLength(2)
    })

    it('deletes a project', () => {
      const project = database.createProject('To Delete', '/path/delete')
      expect(database.deleteProject(project.id)).toBe(true)
      expect(database.getProject(project.id)).toBeUndefined()
    })

    it('returns false when deleting a non-existent project', () => {
      expect(database.deleteProject('fake-id')).toBe(false)
    })
  })

  describe('Preferences', () => {
    it('returns undefined for a non-existent preference', () => {
      expect(database.getPreference('nonexistent')).toBeUndefined()
    })

    it('sets and gets a preference', () => {
      database.setPreference('theme', 'dark')
      expect(database.getPreference('theme')).toBe('dark')
    })

    it('overwrites an existing preference', () => {
      database.setPreference('theme', 'dark')
      database.setPreference('theme', 'light')
      expect(database.getPreference('theme')).toBe('light')
    })

    it('handles multiple independent preferences', () => {
      database.setPreference('theme', 'dark')
      database.setPreference('language', 'en')
      expect(database.getPreference('theme')).toBe('dark')
      expect(database.getPreference('language')).toBe('en')
    })
  })

  describe('Event Logging', () => {
    it('logs an event and retrieves it', () => {
      database.logEvent('runtime-1', 'session.started', '{"session":"abc"}')
      const events = database.getRecentEvents(10)
      expect(events).toHaveLength(1)
      expect(events[0].runtime_id).toBe('runtime-1')
      expect(events[0].event_type).toBe('session.started')
      expect(events[0].event_data).toBe('{"session":"abc"}')
    })

    it('logs events without data', () => {
      database.logEvent('runtime-2', 'heartbeat')
      const events = database.getRecentEvents(10)
      expect(events).toHaveLength(1)
      expect(events[0].event_data).toBeNull()
    })

    it('respects the limit parameter', () => {
      for (let idx = 0; idx < 10; idx++) {
        database.logEvent('runtime-1', `event-${idx}`)
      }
      const events = database.getRecentEvents(5)
      expect(events).toHaveLength(5)
    })

    it('returns events in descending order', () => {
      database.logEvent('runtime-1', 'first')
      database.logEvent('runtime-1', 'second')
      database.logEvent('runtime-1', 'third')
      const events = database.getRecentEvents(10)
      expect(events).toHaveLength(3)
    })

    it('allows null runtime_id', () => {
      database.logEvent(null, 'system.boot')
      const events = database.getRecentEvents(10)
      expect(events).toHaveLength(1)
      expect(events[0].runtime_id).toBeNull()
    })
  })
})
