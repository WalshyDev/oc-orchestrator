import { randomUUID } from 'node:crypto'

/**
 * Lease registry for external attachments to OCO sessions.
 *
 * When an external client (e.g. a voice-prompt wrapper script attaching the
 * opencode TUI) wants to keep an agent's runtime alive while it's connected,
 * it acquires a lease via the HTTP API.  RuntimeManager.stopIdleRuntimes
 * checks the registry before reaping a runtime — any runtime whose directory
 * has an active lease is skipped.
 *
 * Leases have a TTL.  Clients refresh before expiry; expired leases are
 * pruned lazily on the next lookup.  This avoids leaking a lease forever if
 * the external client crashes without releasing.
 */

interface Lease {
  id: string
  directory: string
  sessionId: string
  source: string
  expiresAt: number
}

const DEFAULT_TTL_MS = 30 * 60 * 1000

class LeaseRegistry {
  private leases = new Map<string, Lease>()
  private ttlMs = DEFAULT_TTL_MS

  acquire(directory: string, sessionId: string, source: string): Lease {
    const lease: Lease = {
      id: randomUUID(),
      directory,
      sessionId,
      source,
      expiresAt: Date.now() + this.ttlMs
    }
    this.leases.set(lease.id, lease)
    return lease
  }

  refresh(leaseId: string): Lease | undefined {
    const lease = this.get(leaseId)
    if (!lease) return undefined
    lease.expiresAt = Date.now() + this.ttlMs
    return lease
  }

  release(leaseId: string): boolean {
    return this.leases.delete(leaseId)
  }

  /**
   * Returns true if the directory has at least one non-expired lease.
   * Prunes expired leases as a side effect.
   */
  hasActiveLeaseForDirectory(directory: string): boolean {
    const now = Date.now()
    let found = false
    for (const [id, lease] of this.leases) {
      if (now >= lease.expiresAt) {
        this.leases.delete(id)
        continue
      }
      if (lease.directory === directory) found = true
    }
    return found
  }

  get(leaseId: string): Lease | undefined {
    const lease = this.leases.get(leaseId)
    if (!lease) return undefined
    if (Date.now() >= lease.expiresAt) {
      this.leases.delete(leaseId)
      return undefined
    }
    return lease
  }

  /** Test/debug helper. */
  size(): number {
    return this.leases.size
  }
}

export const leaseRegistry = new LeaseRegistry()
