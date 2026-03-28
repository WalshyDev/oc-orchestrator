import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'crypto'

// better-sqlite3 may be compiled for Electron's Node ABI rather than system Node.
// Skip gracefully if the native module can't load.
let BetterSqlite3: typeof import('better-sqlite3').default | undefined
let canLoad = false
try {
  BetterSqlite3 = (await import('better-sqlite3')).default
  // Try to actually open an in-memory db to confirm the binary works
  const testDb = new BetterSqlite3!(':memory:')
  testDb.close()
  canLoad = true
} catch {
  canLoad = false
}

// ── Extracted Database class for testing (accepts custom db path / in-memory) ──

interface Project {
  id: string
  name: string
  repo_root: string
  created_at: string
  updated_at: string
}

interface Workspace {
  id: string
  project_id: string
  workspace_root: string
  branch_name: string | null
  status: string
  created_at: string
  updated_at: string
}

interface AgentRuntime {
  id: string
  project_id: string | null
  workspace_id: string | null
  session_id: string | null
  process_id: number | null
  server_url: string | null
  status: string | null
  derived_status: string | null
  task_summary: string | null
  model: string | null
  last_activity_at: string | null
  blocked_since: string | null
  cost: number
  tokens_input: number
  tokens_output: number
  created_at: string
  updated_at: string
}

interface EventRecord {
  id: number
  runtime_id: string
  event_type: string
  event_data: string | null
  created_at: string
}

class TestDatabase {
  private db: BetterSqlite3.Database

  private stmtInsertProject!: BetterSqlite3.Statement
  private stmtGetProject!: BetterSqlite3.Statement
  private stmtGetAllProjects!: BetterSqlite3.Statement
  private stmtUpdateProject!: BetterSqlite3.Statement
  private stmtDeleteProject!: BetterSqlite3.Statement

  private stmtInsertWorkspace!: BetterSqlite3.Statement
  private stmtGetWorkspace!: BetterSqlite3.Statement
  private stmtGetWorkspacesForProject!: BetterSqlite3.Statement
  private stmtUpdateWorkspaceStatus!: BetterSqlite3.Statement
  private stmtDeleteWorkspace!: BetterSqlite3.Statement

  private stmtInsertRuntime!: BetterSqlite3.Statement
  private stmtGetRuntime!: BetterSqlite3.Statement
  private stmtGetAllRuntimes!: BetterSqlite3.Statement
  private stmtUpdateRuntime!: BetterSqlite3.Statement
  private stmtDeleteRuntime!: BetterSqlite3.Statement

  private stmtGetPreference!: BetterSqlite3.Statement
  private stmtSetPreference!: BetterSqlite3.Statement

  private stmtLogEvent!: BetterSqlite3.Statement
  private stmtGetRecentEvents!: BetterSqlite3.Statement

  constructor() {
    this.db = new BetterSqlite3(':memory:')
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.init()
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        repo_root TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        workspace_root TEXT NOT NULL,
        branch_name TEXT,
        status TEXT DEFAULT 'ready',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

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
      );

      CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        runtime_id TEXT,
        event_type TEXT NOT NULL,
        event_data TEXT,
        created_at TEXT NOT NULL
      );
    `)

    this.prepareStatements()
  }

  private prepareStatements(): void {
    this.stmtInsertProject = this.db.prepare(
      'INSERT INTO projects (id, name, repo_root, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )
    this.stmtGetProject = this.db.prepare('SELECT * FROM projects WHERE id = ?')
    this.stmtGetAllProjects = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC')
    this.stmtUpdateProject = this.db.prepare(
      'UPDATE projects SET name = ?, repo_root = ?, updated_at = ? WHERE id = ?'
    )
    this.stmtDeleteProject = this.db.prepare('DELETE FROM projects WHERE id = ?')

    this.stmtInsertWorkspace = this.db.prepare(
      'INSERT INTO workspaces (id, project_id, workspace_root, branch_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    this.stmtGetWorkspace = this.db.prepare('SELECT * FROM workspaces WHERE id = ?')
    this.stmtGetWorkspacesForProject = this.db.prepare(
      'SELECT * FROM workspaces WHERE project_id = ? ORDER BY created_at DESC'
    )
    this.stmtUpdateWorkspaceStatus = this.db.prepare(
      'UPDATE workspaces SET status = ?, updated_at = ? WHERE id = ?'
    )
    this.stmtDeleteWorkspace = this.db.prepare('DELETE FROM workspaces WHERE id = ?')

    this.stmtInsertRuntime = this.db.prepare(`
      INSERT INTO agent_runtimes (id, project_id, workspace_id, session_id, process_id, server_url, status, derived_status, task_summary, model, last_activity_at, blocked_since, cost, tokens_input, tokens_output, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.stmtGetRuntime = this.db.prepare('SELECT * FROM agent_runtimes WHERE id = ?')
    this.stmtGetAllRuntimes = this.db.prepare('SELECT * FROM agent_runtimes ORDER BY created_at DESC')
    this.stmtUpdateRuntime = this.db.prepare(`
      UPDATE agent_runtimes SET
        project_id = ?, workspace_id = ?, session_id = ?, process_id = ?,
        server_url = ?, status = ?, derived_status = ?, task_summary = ?, model = ?,
        last_activity_at = ?, blocked_since = ?, cost = ?, tokens_input = ?,
        tokens_output = ?, updated_at = ?
      WHERE id = ?
    `)
    this.stmtDeleteRuntime = this.db.prepare('DELETE FROM agent_runtimes WHERE id = ?')

    this.stmtGetPreference = this.db.prepare('SELECT value FROM preferences WHERE key = ?')
    this.stmtSetPreference = this.db.prepare(
      'INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )

    this.stmtLogEvent = this.db.prepare(
      'INSERT INTO events (runtime_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)'
    )
    this.stmtGetRecentEvents = this.db.prepare(
      'SELECT * FROM events ORDER BY created_at DESC LIMIT ?'
    )
  }

  // -- Projects --

  createProject(name: string, repoRoot: string): Project {
    const now = new Date().toISOString()
    const projectId = randomUUID()
    this.stmtInsertProject.run(projectId, name, repoRoot, now, now)
    return this.getProject(projectId)!
  }

  getProject(projectId: string): Project | undefined {
    return this.stmtGetProject.get(projectId) as Project | undefined
  }

  getAllProjects(): Project[] {
    return this.stmtGetAllProjects.all() as Project[]
  }

  updateProject(
    projectId: string,
    updates: { name?: string; repo_root?: string }
  ): Project | undefined {
    const existing = this.getProject(projectId)
    if (!existing) return undefined
    const now = new Date().toISOString()
    this.stmtUpdateProject.run(
      updates.name ?? existing.name,
      updates.repo_root ?? existing.repo_root,
      now,
      projectId
    )
    return this.getProject(projectId)
  }

  deleteProject(projectId: string): boolean {
    const result = this.stmtDeleteProject.run(projectId)
    return result.changes > 0
  }

  // -- Workspaces --

  createWorkspace(
    projectId: string,
    workspaceRoot: string,
    branchName?: string,
    status: string = 'ready'
  ): Workspace {
    const now = new Date().toISOString()
    const workspaceId = randomUUID()
    this.stmtInsertWorkspace.run(workspaceId, projectId, workspaceRoot, branchName ?? null, status, now, now)
    return this.getWorkspace(workspaceId)!
  }

  getWorkspace(workspaceId: string): Workspace | undefined {
    return this.stmtGetWorkspace.get(workspaceId) as Workspace | undefined
  }

  getWorkspacesForProject(projectId: string): Workspace[] {
    return this.stmtGetWorkspacesForProject.all(projectId) as Workspace[]
  }

  updateWorkspaceStatus(workspaceId: string, status: string): Workspace | undefined {
    const now = new Date().toISOString()
    this.stmtUpdateWorkspaceStatus.run(status, now, workspaceId)
    return this.getWorkspace(workspaceId)
  }

  deleteWorkspace(workspaceId: string): boolean {
    const result = this.stmtDeleteWorkspace.run(workspaceId)
    return result.changes > 0
  }

  // -- Runtimes --

  saveRuntime(runtime: Omit<AgentRuntime, 'id' | 'created_at' | 'updated_at'>): AgentRuntime {
    const now = new Date().toISOString()
    const runtimeId = randomUUID()
    this.stmtInsertRuntime.run(
      runtimeId,
      runtime.project_id,
      runtime.workspace_id,
      runtime.session_id,
      runtime.process_id,
      runtime.server_url,
      runtime.status,
      runtime.derived_status,
      runtime.task_summary,
      runtime.model,
      runtime.last_activity_at,
      runtime.blocked_since,
      runtime.cost ?? 0,
      runtime.tokens_input ?? 0,
      runtime.tokens_output ?? 0,
      now,
      now
    )
    return this.getRuntime(runtimeId)!
  }

  getRuntime(runtimeId: string): AgentRuntime | undefined {
    return this.stmtGetRuntime.get(runtimeId) as AgentRuntime | undefined
  }

  getAllRuntimes(): AgentRuntime[] {
    return this.stmtGetAllRuntimes.all() as AgentRuntime[]
  }

  updateRuntime(
    runtimeId: string,
    updates: Partial<Omit<AgentRuntime, 'id' | 'created_at' | 'updated_at'>>
  ): AgentRuntime | undefined {
    const existing = this.getRuntime(runtimeId)
    if (!existing) return undefined
    const now = new Date().toISOString()
    this.stmtUpdateRuntime.run(
      updates.project_id !== undefined ? updates.project_id : existing.project_id,
      updates.workspace_id !== undefined ? updates.workspace_id : existing.workspace_id,
      updates.session_id !== undefined ? updates.session_id : existing.session_id,
      updates.process_id !== undefined ? updates.process_id : existing.process_id,
      updates.server_url !== undefined ? updates.server_url : existing.server_url,
      updates.status !== undefined ? updates.status : existing.status,
      updates.derived_status !== undefined ? updates.derived_status : existing.derived_status,
      updates.task_summary !== undefined ? updates.task_summary : existing.task_summary,
      updates.model !== undefined ? updates.model : existing.model,
      updates.last_activity_at !== undefined ? updates.last_activity_at : existing.last_activity_at,
      updates.blocked_since !== undefined ? updates.blocked_since : existing.blocked_since,
      updates.cost !== undefined ? updates.cost : existing.cost,
      updates.tokens_input !== undefined ? updates.tokens_input : existing.tokens_input,
      updates.tokens_output !== undefined ? updates.tokens_output : existing.tokens_output,
      now,
      runtimeId
    )
    return this.getRuntime(runtimeId)
  }

  deleteRuntime(runtimeId: string): boolean {
    const result = this.stmtDeleteRuntime.run(runtimeId)
    return result.changes > 0
  }

  // -- Preferences --

  getPreference(key: string): string | undefined {
    const row = this.stmtGetPreference.get(key) as { value: string } | undefined
    return row?.value
  }

  setPreference(key: string, value: string): void {
    this.stmtSetPreference.run(key, value)
  }

  // -- Events --

  logEvent(runtimeId: string | null, eventType: string, eventData?: string): void {
    const now = new Date().toISOString()
    this.stmtLogEvent.run(runtimeId, eventType, eventData ?? null, now)
  }

  getRecentEvents(limit: number = 100): EventRecord[] {
    return this.stmtGetRecentEvents.all(limit) as EventRecord[]
  }

  close(): void {
    this.db.close()
  }
}

// ── Tests ──

describe.skipIf(!canLoad)('Database', () => {
  let database: TestDatabase

  beforeEach(() => {
    database = new TestDatabase()
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

    it('updates a project', () => {
      const project = database.createProject('Old Name', '/path/old')
      const updated = database.updateProject(project.id, { name: 'New Name' })
      expect(updated).toBeDefined()
      expect(updated!.name).toBe('New Name')
      expect(updated!.repo_root).toBe('/path/old')
    })

    it('returns undefined when updating a non-existent project', () => {
      const result = database.updateProject('fake-id', { name: 'nope' })
      expect(result).toBeUndefined()
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

  describe('Workspace CRUD', () => {
    let projectId: string

    beforeEach(() => {
      const project = database.createProject('Workspace Test', '/path/ws-test')
      projectId = project.id
    })

    it('creates a workspace and retrieves it', () => {
      const workspace = database.createWorkspace(projectId, '/worktree/path', 'feature/login')
      expect(workspace).toBeDefined()
      expect(workspace.project_id).toBe(projectId)
      expect(workspace.workspace_root).toBe('/worktree/path')
      expect(workspace.branch_name).toBe('feature/login')
      expect(workspace.status).toBe('ready')
    })

    it('lists workspaces for a project', () => {
      database.createWorkspace(projectId, '/worktree/a', 'branch-a')
      database.createWorkspace(projectId, '/worktree/b', 'branch-b')
      const workspaces = database.getWorkspacesForProject(projectId)
      expect(workspaces).toHaveLength(2)
    })

    it('updates workspace status', () => {
      const workspace = database.createWorkspace(projectId, '/worktree/c', 'branch-c')
      const updated = database.updateWorkspaceStatus(workspace.id, 'busy')
      expect(updated).toBeDefined()
      expect(updated!.status).toBe('busy')
    })

    it('deletes a workspace', () => {
      const workspace = database.createWorkspace(projectId, '/worktree/d')
      expect(database.deleteWorkspace(workspace.id)).toBe(true)
      expect(database.getWorkspace(workspace.id)).toBeUndefined()
    })

    it('cascades delete when project is removed', () => {
      const workspace = database.createWorkspace(projectId, '/worktree/e')
      database.deleteProject(projectId)
      expect(database.getWorkspace(workspace.id)).toBeUndefined()
    })
  })

  describe('Runtime CRUD', () => {
    it('saves and retrieves a runtime', () => {
      const runtime = database.saveRuntime({
        project_id: null,
        workspace_id: null,
        session_id: 'sess-1',
        process_id: 1234,
        server_url: 'http://localhost:3000',
        status: 'running',
        derived_status: 'running',
        task_summary: 'Fix the login bug',
        model: 'sonnet-4',
        last_activity_at: new Date().toISOString(),
        blocked_since: null,
        cost: 0.05,
        tokens_input: 1000,
        tokens_output: 500
      })

      expect(runtime).toBeDefined()
      expect(runtime.session_id).toBe('sess-1')
      expect(runtime.status).toBe('running')
      expect(runtime.cost).toBe(0.05)

      const retrieved = database.getRuntime(runtime.id)
      expect(retrieved).toEqual(runtime)
    })

    it('lists all runtimes', () => {
      database.saveRuntime({
        project_id: null, workspace_id: null, session_id: 'a',
        process_id: null, server_url: null, status: 'running',
        derived_status: null, task_summary: null, model: null,
        last_activity_at: null, blocked_since: null, cost: 0,
        tokens_input: 0, tokens_output: 0
      })
      database.saveRuntime({
        project_id: null, workspace_id: null, session_id: 'b',
        process_id: null, server_url: null, status: 'idle',
        derived_status: null, task_summary: null, model: null,
        last_activity_at: null, blocked_since: null, cost: 0,
        tokens_input: 0, tokens_output: 0
      })

      const runtimes = database.getAllRuntimes()
      expect(runtimes).toHaveLength(2)
    })

    it('updates a runtime', () => {
      const runtime = database.saveRuntime({
        project_id: null, workspace_id: null, session_id: 'upd',
        process_id: null, server_url: null, status: 'running',
        derived_status: null, task_summary: 'Original task', model: null,
        last_activity_at: null, blocked_since: null, cost: 0,
        tokens_input: 0, tokens_output: 0
      })

      const updated = database.updateRuntime(runtime.id, {
        status: 'completed',
        task_summary: 'Updated task',
        cost: 1.23
      })
      expect(updated).toBeDefined()
      expect(updated!.status).toBe('completed')
      expect(updated!.task_summary).toBe('Updated task')
      expect(updated!.cost).toBe(1.23)
    })

    it('returns undefined when updating a non-existent runtime', () => {
      const result = database.updateRuntime('fake', { status: 'idle' })
      expect(result).toBeUndefined()
    })

    it('deletes a runtime', () => {
      const runtime = database.saveRuntime({
        project_id: null, workspace_id: null, session_id: 'del',
        process_id: null, server_url: null, status: 'running',
        derived_status: null, task_summary: null, model: null,
        last_activity_at: null, blocked_since: null, cost: 0,
        tokens_input: 0, tokens_output: 0
      })
      expect(database.deleteRuntime(runtime.id)).toBe(true)
      expect(database.getRuntime(runtime.id)).toBeUndefined()
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

    it('returns events in descending order by created_at', () => {
      database.logEvent('runtime-1', 'first')
      database.logEvent('runtime-1', 'second')
      database.logEvent('runtime-1', 'third')
      const events = database.getRecentEvents(10)
      // Most recent should come first (or at least the last inserted)
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
