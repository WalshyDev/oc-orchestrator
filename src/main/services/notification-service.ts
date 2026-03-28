import { Notification, BrowserWindow, app } from 'electron'

export type NotifiableEventType =
  | 'needs_approval'
  | 'needs_input'
  | 'errored'
  | 'completed'
  | 'disconnected'

export interface NotificationPreferences {
  needs_approval: boolean
  needs_input: boolean
  errored: boolean
  completed: boolean
  disconnected: boolean
}

interface SentNotificationKey {
  agentId: string
  eventType: NotifiableEventType
}

const DEDUP_WINDOW_MS = 30_000

const NOTIFICATION_TITLES: Record<NotifiableEventType, (agentName: string) => string> = {
  needs_approval: (agentName) => `Agent ${agentName} needs approval`,
  needs_input: (agentName) => `Agent ${agentName} needs your input`,
  errored: (agentName) => `Agent ${agentName} encountered an error`,
  completed: (agentName) => `Agent ${agentName} completed its task`,
  disconnected: (agentName) => `Runtime disconnected from agent ${agentName}`
}

const NOTIFICATION_BODIES: Record<NotifiableEventType, (projectName?: string) => string> = {
  needs_approval: (projectName) => projectName ? `Project: ${projectName}` : 'Action requires your approval',
  needs_input: (projectName) => projectName ? `Project: ${projectName}` : 'Waiting for your input',
  errored: (projectName) => projectName ? `Project: ${projectName}` : 'Check the agent for details',
  completed: (projectName) => projectName ? `Project: ${projectName}` : 'Task finished successfully',
  disconnected: (projectName) => projectName ? `Project: ${projectName}` : 'Connection lost'
}

class NotificationService {
  private preferences: NotificationPreferences = {
    needs_approval: true,
    needs_input: true,
    errored: true,
    completed: false,
    disconnected: true
  }

  private sentNotifications = new Map<string, number>()

  setPreference(eventType: NotifiableEventType, enabled: boolean): void {
    this.preferences[eventType] = enabled
  }

  getPreferences(): NotificationPreferences {
    return { ...this.preferences }
  }

  updateBadgeCount(blockedCount: number): void {
    try {
      app.setBadgeCount(blockedCount)
    } catch (error) {
      console.error('[NotificationService] Failed to set badge count:', error)
    }
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
    this.sendNotification(agentId, status, agentName, projectName)
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

    // Clean up old entries periodically
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

  private sendNotification(
    agentId: string,
    eventType: NotifiableEventType,
    agentName: string,
    projectName?: string
  ): void {
    if (!Notification.isSupported()) {
      console.warn('[NotificationService] Notifications not supported on this platform')
      return
    }

    const title = NOTIFICATION_TITLES[eventType](agentName)
    const body = NOTIFICATION_BODIES[eventType](projectName)

    const notification = new Notification({
      title,
      body,
      silent: false
    })

    notification.on('click', () => {
      this.handleNotificationClick(agentId)
    })

    notification.show()
  }

  private handleNotificationClick(agentId: string): void {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length === 0) {
      return
    }

    const mainWindow = windows[0]

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    mainWindow.focus()
    mainWindow.webContents.send('notification:select-agent', { agentId })
  }
}

export const notificationService = new NotificationService()
