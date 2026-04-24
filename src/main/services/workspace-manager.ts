import { execSync, execFileSync, exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import os from 'os'

const execAsync = promisify(exec)

export interface WorktreeInfo {
  worktreePath: string
  branchName: string
}

export interface FreshWorktreeInfo extends WorktreeInfo {
  baseRef: string
}

export interface WorktreeListEntry {
  path: string
  head: string
  branch: string
}

export interface WorktreeStatus {
  dirty: boolean
  changedFiles: number
}

/** One row in the git status porcelain v2 output, normalized for the UI. */
export interface GitStatusFile {
  /** Forward-slash relative path from the worktree root. */
  path: string
  /** Original path if this is a rename/copy entry. */
  oldPath?: string
  /** One of: added, modified, deleted, renamed, copied, untracked, unmerged, typechange. */
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'unmerged' | 'typechange'
  /** Whether the change is staged in the index. */
  staged: boolean
  /** Whether there are further unstaged changes on top of any staged changes. */
  unstaged: boolean
}

export interface FileReadResult {
  content: string
  mtimeMs: number
  size: number
  encoding: 'utf-8' | 'binary'
  truncated: boolean
}

/** Max bytes we'll read into the editor. Anything larger gets truncated with a warning. */
const MAX_READABLE_FILE_SIZE = 5 * 1024 * 1024

/** Probe up to this many bytes looking for a NUL before declaring a file binary. */
const BINARY_SNIFF_SIZE = 8192

/**
 * Thrown by writeFileSafe when the on-disk file changed since the caller read
 * it (mtime mismatch) or was deleted out from under us. IPC handlers catch
 * this specifically and surface a structured CONFLICT response to the UI so
 * the user can pick overwrite / discard / cancel.
 */
export class FileWriteConflictError extends Error {
  readonly code = 'CONFLICT' as const
  constructor(message: string, readonly currentMtimeMs: number | null) {
    super(message)
    this.name = 'FileWriteConflictError'
  }
}

export interface DirectoryContext {
  repoName: string
  branchName: string
  isWorktree: boolean
  workspaceName: string
}

// eslint-disable-next-line no-control-regex
const GIT_REF_INVALID_CHARS = /[\x00-\x1f\x7f ~^:?*[\]\\]/

/** Normalize a git-reported path to forward slashes for consistent UI display. */
function normalizePath(value: string): string {
  return value.replace(/\\/g, '/')
}

/**
 * Interpret the 2-char XY status field from `git status --porcelain=v2`.
 * X = index (staged) state, Y = worktree (unstaged) state. Either side can
 * be '.' meaning "no change". We pick the more interesting of the two
 * for a single-line UI display.
 */
function interpretPorcelainXY(xy: string): {
  status: GitStatusFile['status'] | null
  staged: boolean
  unstaged: boolean
} {
  if (xy.length < 2) return { status: null, staged: false, unstaged: false }
  const x = xy[0]
  const y = xy[1]
  const staged = x !== '.' && x !== ' ' && x !== '?'
  const unstaged = y !== '.' && y !== ' ' && y !== '?'

  // Prefer whichever side has a real status code. Staged often wins for UI
  // purposes because the hunks will show up in the staged diff.
  const pick = staged ? x : y
  switch (pick) {
    case 'M': return { status: 'modified', staged, unstaged }
    case 'A': return { status: 'added', staged, unstaged }
    case 'D': return { status: 'deleted', staged, unstaged }
    case 'R': return { status: 'renamed', staged, unstaged }
    case 'C': return { status: 'copied', staged, unstaged }
    case 'T': return { status: 'typechange', staged, unstaged }
    case 'U': return { status: 'unmerged', staged, unstaged }
    default: return { status: null, staged, unstaged }
  }
}

function validateGitRef(ref: string): string {
  const trimmed = ref.trim()
  if (!trimmed) throw new Error('Git ref cannot be empty')
  if (GIT_REF_INVALID_CHARS.test(trimmed)) throw new Error(`Invalid characters in git ref: ${trimmed}`)
  if (trimmed.startsWith('-')) throw new Error(`Git ref cannot start with a dash: ${trimmed}`)
  if (trimmed.includes('..')) throw new Error(`Git ref cannot contain "..": ${trimmed}`)
  if (trimmed.endsWith('.lock') || trimmed.endsWith('.')) throw new Error(`Git ref cannot end with ".lock" or ".": ${trimmed}`)
  return trimmed
}

/**
 * Manages Git worktrees for agent isolation.
 * Each agent task gets its own worktree so work can proceed in parallel
 * without branch conflicts.
 */
class WorkspaceManager {
  private claimedWorktrees = new Set<string>()

  /**
   * Returns the managed root directory for worktrees.
   * Creates the directory if it does not exist.
   */
  getWorktreeRoot(): string {
    const rootDir = path.join(os.homedir(), '.oc-orchestrator', 'worktrees')
    if (!fs.existsSync(rootDir)) {
      fs.mkdirSync(rootDir, { recursive: true })
      console.log(`[WorkspaceManager] Created worktree root: ${rootDir}`)
    }
    return rootDir
  }

  /**
   * Creates a new git worktree for an agent task.
   * The worktree gets its own branch based on HEAD so the agent
   * can work independently.
   */
  createWorktree(repoRoot: string, projectSlug: string, taskSlug: string): WorktreeInfo {
    const timestamp = Date.now()
    const safeProjSlug = projectSlug.slice(0, 50)
    const safeTaskSlug = taskSlug.slice(0, 50)
    const branchName = `${safeProjSlug}/${safeTaskSlug}-${timestamp}`
    const worktreeRoot = this.getWorktreeRoot()
    const worktreePath = path.join(worktreeRoot, safeProjSlug, `${safeTaskSlug}-${timestamp}`)

    try {
      // Ensure the parent directory exists
      const parentDir = path.dirname(worktreePath)
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true })
      }

      console.log(`[WorkspaceManager] Creating worktree at ${worktreePath} on branch ${branchName}`)

      execSync(`git worktree add -b "${branchName}" "${worktreePath}" HEAD`, {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: 'pipe'
      })

      console.log(`[WorkspaceManager] Worktree created successfully`)

      return { worktreePath, branchName }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to create worktree: ${message}`)
      throw new Error(`Failed to create worktree: ${message}`)
    }
  }

  /**
   * Runs `git fetch origin --prune`, handling case-insensitive ref collisions
   * that occur on macOS when remote branches differ only by case (e.g.
   * `jcabot/AAA-810` vs `jcabot/aaa-810`).  On failure, strips the
   * conflicting entries from packed-refs and retries once.
   */
  private fetchOriginWithPrune(cwd: string): void {
    const gitOpts = { cwd, encoding: 'utf-8' as const, stdio: 'pipe' as const }
    const fetchArgs = ['fetch', 'origin', '--prune']

    try {
      execFileSync('git', fetchArgs, gitOpts)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (!msg.includes('cannot lock ref')) {
        throw error
      }

      console.warn('[WorkspaceManager] Ref lock conflict during fetch --prune, repairing packed-refs')
      this.repairPackedRefs(cwd, msg)

      execFileSync('git', fetchArgs, gitOpts)
    }
  }

  private repairPackedRefs(cwd: string, errorMessage: string): void {
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd, encoding: 'utf-8', stdio: 'pipe'
    }).trim()
    const packedRefsPath = path.resolve(cwd, gitDir, 'packed-refs')

    const refMatch = errorMessage.match(/cannot lock ref '([^']+)'/)
    if (refMatch && fs.existsSync(packedRefsPath)) {
      const refPath = refMatch[1].toLowerCase()
      const content = fs.readFileSync(packedRefsPath, 'utf-8')
      const filtered = content
        .split('\n')
        .filter((line) => !line.toLowerCase().includes(refPath))
        .join('\n')
      fs.writeFileSync(packedRefsPath, filtered, 'utf-8')
      console.warn(`[WorkspaceManager] Removed case-conflicting ref "${refMatch[1]}" from packed-refs`)
    }

    const lockMatch = errorMessage.match(/Unable to create '([^']+\.lock)'/)
    if (lockMatch && fs.existsSync(lockMatch[1])) {
      fs.unlinkSync(lockMatch[1])
      console.warn(`[WorkspaceManager] Removed stale lock file: ${lockMatch[1]}`)
    }
  }

  /**
   * Creates a fresh worktree based on the latest default branch from origin.
   * Fetches first, then resolves the base ref — so the branch name is always
   * up-to-date even when origin/HEAD has changed.
   */
  createFreshWorktree(repoRoot: string, projectSlug: string, taskSlug: string, explicitBaseRef?: string): FreshWorktreeInfo {
    const timestamp = Date.now()
    const safeProjSlug = projectSlug.slice(0, 50)
    const safeTaskSlug = taskSlug.slice(0, 50)
    const branchName = `${safeProjSlug}/${safeTaskSlug}-${timestamp}`
    const worktreeRoot = this.getWorktreeRoot()
    const worktreePath = path.join(worktreeRoot, safeProjSlug, `${safeTaskSlug}-${timestamp}`)

    try {
      const parentDir = path.dirname(worktreePath)
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true })
      }

      this.fetchOriginWithPrune(repoRoot)

      // Resolve after fetch so origin/HEAD reflects the latest remote state
      const baseRef = explicitBaseRef
        ? validateGitRef(explicitBaseRef)
        : this.getDefaultBranch(repoRoot)

      console.log(`[WorkspaceManager] Creating fresh worktree at ${worktreePath} from ${baseRef}`)

      execFileSync('git', ['worktree', 'add', '-b', branchName, worktreePath, baseRef], {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: 'pipe'
      })

      console.log('[WorkspaceManager] Fresh worktree created successfully')

      return { worktreePath, branchName, baseRef }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to create fresh worktree: ${message}`)
      throw new Error(`Failed to create fresh worktree: ${message}`)
    }
  }

  /**
   * Removes a worktree and prunes stale worktree references.
   */
  async removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
    try {
      console.log(`[WorkspaceManager] Removing worktree at ${worktreePath}`)

      await execAsync(`git worktree remove "${worktreePath}" --force`, {
        cwd: repoRoot,
        encoding: 'utf-8'
      })

      await execAsync('git worktree prune', {
        cwd: repoRoot,
        encoding: 'utf-8'
      })

      // Release the claim if it was claimed
      this.claimedWorktrees.delete(worktreePath)

      console.log(`[WorkspaceManager] Worktree removed and pruned`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to remove worktree: ${message}`)
      throw new Error(`Failed to remove worktree: ${message}`)
    }
  }

  /**
   * Lists all worktrees for a given repo.
   */
  listWorktrees(repoRoot: string): WorktreeListEntry[] {
    try {
      const output = execSync('git worktree list --porcelain', {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: 'pipe'
      })

      const entries: WorktreeListEntry[] = []
      const blocks = output.trim().split('\n\n')

      for (const block of blocks) {
        if (!block.trim()) continue

        const lines = block.trim().split('\n')
        let worktreePath = ''
        let head = ''
        let branch = ''

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            worktreePath = line.replace('worktree ', '')
          } else if (line.startsWith('HEAD ')) {
            head = line.replace('HEAD ', '')
          } else if (line.startsWith('branch ')) {
            branch = line.replace('branch refs/heads/', '')
          }
        }

        if (worktreePath) {
          entries.push({ path: worktreePath, head, branch })
        }
      }

      return entries
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to list worktrees: ${message}`)
      throw new Error(`Failed to list worktrees: ${message}`)
    }
  }

  /**
   * Validates whether a directory is a git repository.
   */
  isGitRepo(directory: string): boolean {
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: 'pipe'
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * Gets the root of a git repository from any path within it.
   */
  getRepoRoot(directory: string): string {
    try {
      const root = execSync('git rev-parse --show-toplevel', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: 'pipe'
      })
      return root.trim()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to get repo root: ${message}`)
      throw new Error(`Failed to get repo root: ${message}`)
    }
  }

  async getCommonRepoRoot(directory: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse --path-format=absolute --git-common-dir', {
        cwd: directory,
        encoding: 'utf-8'
      })

      return path.dirname(stdout.trim())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to get common repo root: ${message}`)
      throw new Error(`Failed to get common repo root: ${message}`)
    }
  }

  /**
   * Gets the current branch name for a directory.
   */
  getCurrentBranch(directory: string): string {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: 'pipe'
      })
      return branch.trim()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to get current branch: ${message}`)
      throw new Error(`Failed to get current branch: ${message}`)
    }
  }

  getDirectoryContext(directory: string): DirectoryContext {
    try {
      const workspaceRoot = execSync('git rev-parse --show-toplevel', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim()

      const gitDir = execSync('git rev-parse --path-format=absolute --git-dir', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim()

      const gitCommonDir = execSync('git rev-parse --path-format=absolute --git-common-dir', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim()

      const repoRoot = path.dirname(gitCommonDir)

      return {
        repoName: path.basename(repoRoot),
        branchName: this.getCurrentBranch(directory),
        isWorktree: path.normalize(gitDir) !== path.normalize(gitCommonDir),
        workspaceName: path.basename(workspaceRoot)
      }
    } catch (error) {
      const fallbackName = path.basename(directory)
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to get directory context: ${message}`)
      return {
        repoName: fallbackName,
        branchName: '',
        isWorktree: false,
        workspaceName: fallbackName
      }
    }
  }

  /**
   * Fetches origin, creates a new branch off the default branch, and checks
   * it out in the given directory.  Returns the new branch name.
   */
  async resetToDefaultBranch(directory: string, projectSlug: string, taskSlug: string): Promise<string> {
    const repoRoot = await this.getCommonRepoRoot(directory)

    this.fetchOriginWithPrune(directory)

    const baseRef = this.getDefaultBranch(repoRoot)
    const timestamp = Date.now()
    const safeProjSlug = projectSlug.slice(0, 50)
    const safeTaskSlug = taskSlug.slice(0, 50)
    const branchName = `${safeProjSlug}/${safeTaskSlug}-${timestamp}`

    // Discard uncommitted changes, create a fresh branch off the default branch
    execSync('git clean -fd', {
      cwd: directory,
      encoding: 'utf-8',
      stdio: 'pipe'
    })

    execSync(`git checkout -B "${branchName}" "${baseRef}"`, {
      cwd: directory,
      encoding: 'utf-8',
      stdio: 'pipe'
    })

    return branchName
  }

  getDefaultBranch(repoRoot: string): string {
    const gitOpts = { cwd: repoRoot, encoding: 'utf-8' as const, stdio: 'pipe' as const }

    const readOriginHead = (): string | null => {
      try {
        return execSync('git symbolic-ref refs/remotes/origin/HEAD', gitOpts)
          .trim()
          .replace('refs/remotes/', '')
      } catch {
        return null
      }
    }

    // Fast path: local symbolic-ref already cached
    const cached = readOriginHead()
    if (cached) return cached

    // Query the remote and cache locally
    try {
      execSync('git remote set-head origin --auto', { ...gitOpts, timeout: 10_000 })
      const resolved = readOriginHead()
      if (resolved) return resolved
    } catch {
      // Network unavailable or remote doesn't support it
    }

    // Last resort: probe for common branch names
    for (const name of ['main', 'master', 'staging', 'develop']) {
      try {
        execSync(`git rev-parse --verify origin/${name}`, gitOpts)
        return `origin/${name}`
      } catch {
        continue
      }
    }

    return 'origin/main'
  }

  /**
   * Checks if a worktree has uncommitted changes.
   */
  getWorktreeStatus(worktreePath: string): WorktreeStatus {
    try {
      const output = execSync('git status --porcelain', {
        cwd: worktreePath,
        encoding: 'utf-8',
        stdio: 'pipe'
      })

      const changedLines = output.trim().split('\n').filter((line) => line.trim().length > 0)
      const changedFiles = changedLines.length

      return {
        dirty: changedFiles > 0,
        changedFiles
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to get worktree status: ${message}`)
      throw new Error(`Failed to get worktree status: ${message}`)
    }
  }

  /**
   * Returns the list of files with uncommitted changes in a worktree,
   * parsed from `git status --porcelain=v2 -z`.
   *
   * Porcelain v2 is used because:
   *   - NUL-delimited output avoids filename quoting issues
   *   - Rename/copy entries carry both paths explicitly
   *   - The XY status field is documented and stable
   */
  getGitStatus(worktreePath: string): GitStatusFile[] {
    const output = execFileSync('git', ['status', '--porcelain=v2', '-z', '--untracked-files=all'], {
      cwd: worktreePath,
      encoding: 'utf-8',
      stdio: 'pipe'
    })

    const files: GitStatusFile[] = []
    // NUL-delimited records. Rename/copy records consume an extra field for the
    // original path, so we can't just split on NUL — we have to parse token by token.
    let i = 0
    while (i < output.length) {
      const end = output.indexOf('\0', i)
      if (end === -1) break
      const record = output.slice(i, end)
      i = end + 1

      if (!record) continue

      const recordType = record[0]
      if (recordType === '1') {
        // Changed entry: "1 XY sub <mH> <mI> <mW> <hH> <hI> <path>"
        const parts = record.split(' ')
        const xy = parts[1] ?? ''
        const filePath = parts.slice(8).join(' ')
        const { status, staged, unstaged } = interpretPorcelainXY(xy)
        if (status) files.push({ path: normalizePath(filePath), status, staged, unstaged })
      } else if (recordType === '2') {
        // Renamed/copied entry: "2 XY sub <mH> <mI> <mW> <hH> <hI> <score> <path>"
        // followed by NUL and then <origPath>.
        const parts = record.split(' ')
        const xy = parts[1] ?? ''
        const newPath = parts.slice(9).join(' ')
        // Consume the orig-path record that immediately follows.
        const origEnd = output.indexOf('\0', i)
        const origPath = origEnd === -1 ? '' : output.slice(i, origEnd)
        if (origEnd !== -1) i = origEnd + 1
        const { status, staged, unstaged } = interpretPorcelainXY(xy)
        files.push({
          path: normalizePath(newPath),
          oldPath: normalizePath(origPath),
          status: status ?? 'renamed',
          staged,
          unstaged
        })
      } else if (recordType === 'u') {
        // Unmerged: "u XY sub <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
        const parts = record.split(' ')
        const filePath = parts.slice(10).join(' ')
        files.push({ path: normalizePath(filePath), status: 'unmerged', staged: false, unstaged: true })
      } else if (recordType === '?') {
        // Untracked: "? <path>"
        const filePath = record.slice(2)
        files.push({ path: normalizePath(filePath), status: 'untracked', staged: false, unstaged: true })
      }
      // '!' ignored entries are skipped (we don't ask for them).
    }

    return files
  }

  /**
   * Returns the working-tree version of a file (for the diff "after" side) and
   * the HEAD version (for the "before" side). Used by the diff viewer.
   *
   * For untracked files, `before` is an empty string. For deleted files,
   * `after` is an empty string.
   */
  getDiffSides(worktreePath: string, relativePath: string): { before: string; after: string } {
    const safePath = relativePath.replace(/^\/+/, '')
    let before = ''
    let after = ''

    // HEAD version — may not exist if file is untracked or added since HEAD.
    try {
      before = execFileSync('git', ['show', `HEAD:${safePath}`], {
        cwd: worktreePath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        maxBuffer: MAX_READABLE_FILE_SIZE * 2
      })
    } catch {
      before = ''
    }

    // Working tree version — may not exist if file was deleted.
    const abs = path.join(worktreePath, safePath)
    try {
      if (fs.existsSync(abs)) {
        const stat = fs.statSync(abs)
        if (stat.size <= MAX_READABLE_FILE_SIZE) {
          after = fs.readFileSync(abs, 'utf-8')
        }
      }
    } catch {
      after = ''
    }

    return { before, after }
  }

  /**
   * Safely reads a file from a worktree. Guards against path traversal and
   * symlink escapes by realpath-resolving both the root and target and
   * verifying containment.
   */
  readFileSafe(worktreePath: string, relativePath: string): FileReadResult {
    const abs = this.resolveInsideWorktree(worktreePath, relativePath)
    const stat = fs.statSync(abs)

    if (stat.isDirectory()) {
      throw new Error(`Path is a directory: ${relativePath}`)
    }

    const truncated = stat.size > MAX_READABLE_FILE_SIZE
    const readSize = truncated ? MAX_READABLE_FILE_SIZE : stat.size
    const buffer = Buffer.alloc(readSize)

    const fd = fs.openSync(abs, 'r')
    try {
      fs.readSync(fd, buffer, 0, readSize, 0)
    } finally {
      fs.closeSync(fd)
    }

    // Binary sniff: look for a NUL byte in the first chunk of what we read.
    // This catches most real binaries (images, pdfs, compiled artifacts)
    // without false-positiving on UTF-8 text. Cheap because we already have
    // the bytes in memory.
    const sniffEnd = Math.min(readSize, BINARY_SNIFF_SIZE)
    const nulIdx = buffer.indexOf(0)
    if (nulIdx !== -1 && nulIdx < sniffEnd) {
      return { content: '', mtimeMs: stat.mtimeMs, size: stat.size, encoding: 'binary', truncated: false }
    }

    return {
      content: buffer.toString('utf-8'),
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      encoding: 'utf-8',
      truncated
    }
  }

  /**
   * Writes a file inside a worktree with optimistic concurrency. The caller
   * passes `expectedMtimeMs` — the mtime observed at read time. If the file
   * on disk has since changed (e.g. the agent wrote to it), the write is
   * rejected with a conflict error so the UI can prompt the user before
   * clobbering.
   *
   * Pass `expectedMtimeMs: null` to force-write unconditionally (used after
   * the user picks "overwrite" in the conflict modal).
   *
   * The write is atomic: we write to a sibling temp file and rename, which
   * avoids leaving a half-written file if the process dies mid-write.
   */
  writeFileSafe(
    worktreePath: string,
    relativePath: string,
    content: string,
    expectedMtimeMs: number | null
  ): { mtimeMs: number; size: number } {
    const abs = this.resolveInsideWorktree(worktreePath, relativePath)

    // Concurrency check: if the file exists, its mtime must match what the
    // caller saw. If it doesn't exist yet (new file from the UI side) the
    // caller is expected to pass `expectedMtimeMs: null` to skip the check.
    if (expectedMtimeMs !== null) {
      let currentStat: fs.Stats
      try {
        currentStat = fs.statSync(abs)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // File vanished since we read it. Treat as conflict — the user
          // probably wants to know before we re-create it.
          throw new FileWriteConflictError('file was deleted on disk', null)
        }
        throw error
      }
      if (currentStat.mtimeMs !== expectedMtimeMs) {
        throw new FileWriteConflictError(
          'file changed on disk since it was read',
          currentStat.mtimeMs
        )
      }
    }

    // Atomic write: temp file in the same directory, then rename. Same-
    // directory rename is atomic on POSIX and NTFS, so a crash mid-write
    // leaves the original intact.
    const dir = path.dirname(abs)
    const base = path.basename(abs)
    const tmp = path.join(dir, `.${base}.oco-tmp.${process.pid}.${Date.now()}`)

    fs.writeFileSync(tmp, content, { encoding: 'utf-8' })
    try {
      fs.renameSync(tmp, abs)
    } catch (error) {
      // Best-effort cleanup of the temp file if the rename failed.
      try { fs.unlinkSync(tmp) } catch { /* ignore */ }
      throw error
    }

    const finalStat = fs.statSync(abs)
    return { mtimeMs: finalStat.mtimeMs, size: finalStat.size }
  }

  /**
   * Public wrapper around the internal path resolver. IPC handlers use this
   * to validate renderer-supplied paths before handing them to other
   * services (file watcher, etc).
   */
  resolveWorktreeRelativePath(worktreePath: string, relativePath: string): string {
    return this.resolveInsideWorktree(worktreePath, relativePath)
  }

  /**
   * Resolves a user-supplied relative path inside a worktree, following
   * symlinks and rejecting anything that escapes the root. Returns the
   * absolute realpath suitable for direct fs use.
   *
   * Symlink handling: we realpath the *parent* directory and then append the
   * basename. This way a symlink pointing outside the worktree gets rejected
   * before we read through it. We also realpath the worktree root so the
   * containment check works even if the root itself is a symlink.
   */
  private resolveInsideWorktree(worktreePath: string, relativePath: string): string {
    if (!relativePath || typeof relativePath !== 'string') {
      throw new Error('relativePath is required')
    }
    // Strip leading slashes and resolve `..` components without touching disk.
    const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/').replace(/^\/+/, ''))
    if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
      throw new Error(`Path escapes worktree: ${relativePath}`)
    }

    const rootReal = fs.realpathSync(worktreePath)
    const joined = path.join(rootReal, normalized)

    // Realpath the *final* path if it exists (to follow symlinks and validate),
    // otherwise realpath the parent directory and append the basename.
    let resolved: string
    try {
      resolved = fs.realpathSync(joined)
    } catch {
      const parent = path.dirname(joined)
      const parentReal = fs.realpathSync(parent)
      resolved = path.join(parentReal, path.basename(joined))
    }

    const rootWithSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep
    if (resolved !== rootReal && !resolved.startsWith(rootWithSep)) {
      throw new Error(`Path escapes worktree: ${relativePath}`)
    }

    return resolved
  }

  /**
   * Claims a worktree so no other runtime can use it.
   * Throws if the worktree is already claimed.
   */
  claimWorktree(worktreeId: string): void {
    if (this.claimedWorktrees.has(worktreeId)) {
      throw new Error(`Worktree "${worktreeId}" is already claimed by another runtime`)
    }
    this.claimedWorktrees.add(worktreeId)
    console.log(`[WorkspaceManager] Claimed worktree: ${worktreeId}`)
  }

  /**
   * Releases a previously claimed worktree so it can be used again.
   */
  releaseWorktree(worktreeId: string): void {
    if (!this.claimedWorktrees.has(worktreeId)) {
      console.warn(`[WorkspaceManager] Attempted to release unclaimed worktree: ${worktreeId}`)
      return
    }
    this.claimedWorktrees.delete(worktreeId)
    console.log(`[WorkspaceManager] Released worktree: ${worktreeId}`)
  }
}

export const workspaceManager = new WorkspaceManager()
