import BetterSqlite3 from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'

export interface Project {
  id: string
  name: string
  repo_root: string
  created_at: string
  updated_at: string
}

export interface Workspace {
  id: string
  project_id: string
  workspace_root: string
  branch_name: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface AgentRuntime {
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

export interface Session {
  id: string
  runtime_id: string
  title: string | null
  created_at: string
}

export interface RuntimeHealth {
  id: string
  runtime_id: string
  healthy: number
  checked_at: string
}

export interface EventRecord {
  id: number
  runtime_id: string
  event_type: string
  event_data: string | null
  created_at: string
}

class Database {
  private db: BetterSqlite3.Database

  // Prepared statements
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
    const dbPath = join(app.getPath('userData'), 'oc-orchestrator.db')
    this.db = new BetterSqlite3(dbPath)

    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')

    this.init()
  }

  init(): void {
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

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        runtime_id TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runtime_health (
        id TEXT PRIMARY KEY,
        runtime_id TEXT NOT NULL,
        healthy INTEGER NOT NULL,
        checked_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        runtime_id TEXT,
        event_type TEXT NOT NULL,
        event_data TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `)

    this.prepareStatements()
  }

  private prepareStatements(): void {
    // Projects
    this.stmtInsertProject = this.db.prepare(
      'INSERT INTO projects (id, name, repo_root, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )
    this.stmtGetProject = this.db.prepare('SELECT * FROM projects WHERE id = ?')
    this.stmtGetAllProjects = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC')
    this.stmtUpdateProject = this.db.prepare(
      'UPDATE projects SET name = ?, repo_root = ?, updated_at = ? WHERE id = ?'
    )
    this.stmtDeleteProject = this.db.prepare('DELETE FROM projects WHERE id = ?')

    // Workspaces
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

    // Runtimes
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

    // Preferences
    this.stmtGetPreference = this.db.prepare('SELECT value FROM preferences WHERE key = ?')
    this.stmtSetPreference = this.db.prepare(
      'INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )

    // Events
    this.stmtLogEvent = this.db.prepare(
      'INSERT INTO events (runtime_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)'
    )
    this.stmtGetRecentEvents = this.db.prepare(
      'SELECT * FROM events ORDER BY created_at DESC LIMIT ?'
    )
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Workspaces
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Agent Runtimes
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Preferences
  // ---------------------------------------------------------------------------

  getPreference(key: string): string | undefined {
    const row = this.stmtGetPreference.get(key) as { value: string } | undefined
    return row?.value
  }

  setPreference(key: string, value: string): void {
    this.stmtSetPreference.run(key, value)
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  logEvent(runtimeId: string | null, eventType: string, eventData?: string): void {
    const now = new Date().toISOString()
    this.stmtLogEvent.run(runtimeId, eventType, eventData ?? null, now)
  }

  getRecentEvents(limit: number = 100): EventRecord[] {
    return this.stmtGetRecentEvents.all(limit) as EventRecord[]
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  close(): void {
    this.db.close()
  }
}

export const database = new Database()
