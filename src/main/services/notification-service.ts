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

  private soundEnabled = true

  private sentNotifications = new Map<string, number>()

  // Prevent Notification objects from being garbage-collected before the
  // user interacts with them.  Without this reference the 'click' handler
  // is silently lost on macOS because V8 collects the otherwise-unreachable
  // Notification instance.
  private activeNotifications = new Set<Notification>()

  setPreference(eventType: NotifiableEventType, enabled: boolean): void {
    this.preferences[eventType] = enabled
  }

  setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled
  }

  getSoundEnabled(): boolean {
    return this.soundEnabled
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
    projectName?: string,
    preview?: string
  ): void {
    if (!this.preferences[status]) {
      return
    }

    if (this.isDuplicate(agentId, status)) {
      return
    }

    this.recordNotification(agentId, status)
    this.sendNotification(agentId, status, agentName, projectName, preview)
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
    projectName?: string,
    preview?: string
  ): void {
    if (!Notification.isSupported()) {
      console.warn('[NotificationService] Notifications not supported on this platform')
      return
    }

    const title = NOTIFICATION_TITLES[eventType](agentName)
    const defaultBody = NOTIFICATION_BODIES[eventType](projectName)

    // Only show preview for terminal statuses where "what did the agent say?" is relevant.
    // For blocked statuses (needs_approval, needs_input, disconnected) the generic body
    // ("Action requires your approval") is more useful than unrelated assistant text.
    const usePreview = preview && (eventType === 'completed' || eventType === 'errored')
    const body = usePreview
      ? (projectName ? `${projectName}: ${preview}` : preview)
      : defaultBody

    const notification = new Notification({
      title,
      body,
      silent: !this.soundEnabled
    })

    // Prevent GC from collecting the notification before the user clicks it.
    // Without this reference the 'click' handler is silently lost because V8
    // collects the otherwise-unreachable Notification instance while the OS
    // banner is still visible.
    this.activeNotifications.add(notification)

    notification.on('click', () => {
      console.log(`[NotificationService] Notification clicked for agent ${agentId}`)
      this.handleNotificationClick(agentId)
      this.activeNotifications.delete(notification)
    })

    // On macOS the 'close' event fires when the banner auto-dismisses (~5s),
    // but the user can still click the notification later in Notification
    // Center.  Do NOT remove the reference on 'close' — that would allow GC
    // to collect the object and silently drop the click handler.  Instead,
    // clean up stale entries periodically.
    notification.on('close', () => {
      // Schedule cleanup after a generous window so clicks from Notification
      // Center still work.  5 minutes is long enough for any realistic
      // interaction; the Set is tiny so the memory cost is negligible.
      setTimeout(() => {
        this.activeNotifications.delete(notification)
      }, 5 * 60 * 1000)
    })

    notification.show()
  }

  // Stores the agent ID from the most recent notification click so the
  // renderer can pull it if the initial IPC send arrives before the window
  // is ready (e.g. waking from background on macOS).
  private pendingAgentId: string | null = null

  getPendingAgentId(): string | null {
    const id = this.pendingAgentId
    this.pendingAgentId = null
    return id
  }

  private handleNotificationClick(agentId: string): void {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length === 0) {
      console.warn('[NotificationService] No windows available for notification click')
      return
    }

    const mainWindow = windows[0]

    console.log(`[NotificationService] Handling click: agentId=${agentId}, windowFocused=${mainWindow.isFocused()}, minimized=${mainWindow.isMinimized()}`)

    // Stash the agent ID so the renderer can pull it on focus if the
    // push-based IPC message gets lost during the window wake-up.
    this.pendingAgentId = agentId

    // app.show() activates the Electron app at the OS level (macOS dock bounce),
    // which is required before mainWindow.focus() will actually bring it to front
    // when the app isn't the currently focused application.
    app.show()

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('notification:select-agent', { agentId })
  }
}

export const notificationService = new NotificationService()
