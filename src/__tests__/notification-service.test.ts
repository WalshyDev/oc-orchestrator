import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Types extracted from src/main/services/notification-service.ts ──

type NotifiableEventType =
  | 'needs_approval'
  | 'needs_input'
  | 'errored'
  | 'completed'
  | 'disconnected'

interface NotificationPreferences {
  needs_approval: boolean
  needs_input: boolean
  errored: boolean
  completed: boolean
  disconnected: boolean
}

const DEDUP_WINDOW_MS = 30_000

// ── Testable NotificationService (no Electron dependencies) ──

class TestNotificationService {
  private preferences: NotificationPreferences = {
    needs_approval: true,
    needs_input: true,
    errored: true,
    completed: false,
    disconnected: true
  }

  private sentNotifications = new Map<string, number>()
  public notificationsSent: Array<{ agentId: string; status: NotifiableEventType; agentName: string; projectName?: string }> = []

  setPreference(eventType: NotifiableEventType, enabled: boolean): void {
    this.preferences[eventType] = enabled
  }

  getPreferences(): NotificationPreferences {
    return { ...this.preferences }
  }

  checkAndNotify(
    agentId: string,
    status: NotifiableEventType,
    agentName: string,
    projectName?: string
  ): void {
    if (!this.preferences[status]) {
      return
    }

    if (this.isDuplicate(agentId, status)) {
      return
    }

    this.recordNotification(agentId, status)
    this.notificationsSent.push({ agentId, status, agentName, projectName })
  }

  private isDuplicate(agentId: string, eventType: NotifiableEventType): boolean {
    const key = this.buildKey(agentId, eventType)
    const lastSent = this.sentNotifications.get(key)

    if (lastSent === undefined) {
      return false
    }

    return Date.now() - lastSent < DEDUP_WINDOW_MS
  }

  private recordNotification(agentId: string, eventType: NotifiableEventType): void {
    const key = this.buildKey(agentId, eventType)
    this.sentNotifications.set(key, Date.now())

    if (this.sentNotifications.size > 100) {
      this.pruneOldEntries()
    }
  }

  private pruneOldEntries(): void {
    const now = Date.now()
    for (const [key, timestamp] of this.sentNotifications) {
      if (now - timestamp > DEDUP_WINDOW_MS) {
        this.sentNotifications.delete(key)
      }
    }
  }

  private buildKey(agentId: string, eventType: NotifiableEventType): string {
    return `${agentId}:${eventType}`
  }

  // Expose for testing
  getSentNotificationsCount(): number {
    return this.sentNotifications.size
  }
}

// ── Badge Count Tracker (standalone for testing without Electron) ──

class BadgeCountTracker {
  public currentCount = 0

  updateBadgeCount(blockedCount: number): void {
    this.currentCount = blockedCount
  }
}

// ── Tests ──

describe('NotificationService', () => {
  let service: TestNotificationService

  beforeEach(() => {
    service = new TestNotificationService()
  })

  describe('deduplication', () => {
    it('sends a notification for the first occurrence', () => {
      service.checkAndNotify('agent-1', 'needs_input', 'Agent Alpha')
      expect(service.notificationsSent).toHaveLength(1)
    })

    it('deduplicates the same agent+type within the dedup window', () => {
      service.checkAndNotify('agent-1', 'needs_input', 'Agent Alpha')
      service.checkAndNotify('agent-1', 'needs_input', 'Agent Alpha')
      expect(service.notificationsSent).toHaveLength(1)
    })

    it('allows different event types for the same agent', () => {
      service.checkAndNotify('agent-1', 'needs_input', 'Agent Alpha')
      service.checkAndNotify('agent-1', 'errored', 'Agent Alpha')
      expect(service.notificationsSent).toHaveLength(2)
    })

    it('allows the same event type for different agents', () => {
      service.checkAndNotify('agent-1', 'needs_input', 'Agent Alpha')
      service.checkAndNotify('agent-2', 'needs_input', 'Agent Beta')
      expect(service.notificationsSent).toHaveLength(2)
    })

    it('allows re-notification after the dedup window expires', () => {
      const originalNow = Date.now
      let mockTime = 1000000

      vi.spyOn(Date, 'now').mockImplementation(() => mockTime)

      service.checkAndNotify('agent-1', 'needs_input', 'Agent Alpha')
      expect(service.notificationsSent).toHaveLength(1)

      // Still within the dedup window
      mockTime += 10_000
      service.checkAndNotify('agent-1', 'needs_input', 'Agent Alpha')
      expect(service.notificationsSent).toHaveLength(1)

      // Beyond the dedup window
      mockTime += DEDUP_WINDOW_MS + 1
      service.checkAndNotify('agent-1', 'needs_input', 'Agent Alpha')
      expect(service.notificationsSent).toHaveLength(2)

      vi.restoreAllMocks()
    })
  })

  describe('preference management', () => {
    it('returns default preferences', () => {
      const prefs = service.getPreferences()
      expect(prefs.needs_approval).toBe(true)
      expect(prefs.needs_input).toBe(true)
      expect(prefs.errored).toBe(true)
      expect(prefs.completed).toBe(false)
      expect(prefs.disconnected).toBe(true)
    })

    it('does not notify for disabled event types', () => {
      service.setPreference('needs_input', false)
      service.checkAndNotify('agent-1', 'needs_input', 'Agent Alpha')
      expect(service.notificationsSent).toHaveLength(0)
    })

    it('does not notify for "completed" by default', () => {
      service.checkAndNotify('agent-1', 'completed', 'Agent Alpha')
      expect(service.notificationsSent).toHaveLength(0)
    })

    it('notifies for "completed" when enabled', () => {
      service.setPreference('completed', true)
      service.checkAndNotify('agent-1', 'completed', 'Agent Alpha')
      expect(service.notificationsSent).toHaveLength(1)
    })

    it('updates preferences independently', () => {
      service.setPreference('needs_approval', false)
      service.setPreference('errored', false)
      const prefs = service.getPreferences()
      expect(prefs.needs_approval).toBe(false)
      expect(prefs.errored).toBe(false)
      expect(prefs.needs_input).toBe(true)
    })

    it('returns a copy of preferences (not the internal reference)', () => {
      const prefs = service.getPreferences()
      prefs.needs_approval = false
      expect(service.getPreferences().needs_approval).toBe(true)
    })
  })

  describe('notification data', () => {
    it('includes agent name and project name in sent notification', () => {
      service.checkAndNotify('agent-1', 'errored', 'Build Worker', 'my-project')
      expect(service.notificationsSent[0]).toEqual({
        agentId: 'agent-1',
        status: 'errored',
        agentName: 'Build Worker',
        projectName: 'my-project'
      })
    })

    it('handles missing project name', () => {
      service.checkAndNotify('agent-1', 'needs_approval', 'Agent X')
      expect(service.notificationsSent[0].projectName).toBeUndefined()
    })
  })
})

describe('BadgeCountTracker', () => {
  let tracker: BadgeCountTracker

  beforeEach(() => {
    tracker = new BadgeCountTracker()
  })

  it('starts with a count of 0', () => {
    expect(tracker.currentCount).toBe(0)
  })

  it('updates the badge count', () => {
    tracker.updateBadgeCount(3)
    expect(tracker.currentCount).toBe(3)
  })

  it('resets the badge count to 0', () => {
    tracker.updateBadgeCount(5)
    tracker.updateBadgeCount(0)
    expect(tracker.currentCount).toBe(0)
  })

  it('handles large badge counts', () => {
    tracker.updateBadgeCount(99)
    expect(tracker.currentCount).toBe(99)
  })
})
