import { app, shell, BrowserWindow, nativeImage, Menu } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { agentController } from './services/agent-controller'
import { database } from './services/database'
import { runtimeManager } from './services/runtime-manager'
import { startUpdateChecker, stopUpdateChecker } from './services/update-checker'

let mainWindowRef: BrowserWindow | null = null

const WINDOW_BOUNDS_KEY = 'window_bounds'

function getAppIcon(): Electron.NativeImage | undefined {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')

  try {
    return nativeImage.createFromPath(iconPath)
  } catch {
    return undefined
  }
}

function loadWindowBounds(): { x?: number; y?: number; width: number; height: number; maximized?: boolean } {
  try {
    const raw = database.getPreference(WINDOW_BOUNDS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { width: 1440, height: 900 }
}

function saveWindowBounds(window: BrowserWindow): void {
  const maximized = window.isMaximized()
  const bounds = maximized ? window.getNormalBounds() : window.getBounds()
  database.setPreference(WINDOW_BOUNDS_KEY, JSON.stringify({ ...bounds, maximized }))
}

function createWindow(): BrowserWindow {
  const savedBounds = loadWindowBounds()

  const mainWindow = new BrowserWindow({
    icon: getAppIcon(),
    ...savedBounds,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (savedBounds.maximized) {
    mainWindow.maximize()
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('resized', () => saveWindowBounds(mainWindow))
  mainWindow.on('moved', () => saveWindowBounds(mainWindow))
  mainWindow.on('maximize', () => saveWindowBounds(mainWindow))
  mainWindow.on('unmaximize', () => saveWindowBounds(mainWindow))

  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!app.isPackaged && url.startsWith(process.env['ELECTRON_RENDERER_URL'] || '')) return
    if (url.startsWith('file://')) return

    event.preventDefault()
    shell.openExternal(url)
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(async () => {
  // Explicit menu suppresses macOS representedObject warnings from Electron's default
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]))

  // Set dock icon (macOS dev mode)
  const appIcon = getAppIcon()
  if (appIcon && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(appIcon)
  }

  // Initialize the database
  await database.init()
  console.log('[Main] Database initialized')
  database.logEvent(null, 'app:started')

  registerIpcHandlers()

  await agentController.restorePersistedAgents()
  console.log('[Main] Restored persisted agents')

  mainWindowRef = createWindow()

  // Start runtime health checks after window creation
  runtimeManager.startHealthChecks()
  agentController.startIdleRuntimeChecks()
  startUpdateChecker()
  console.log('[Main] Health checks started')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindowRef = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  console.log('[Main] Shutting down all agents and runtimes...')
  stopUpdateChecker()
  agentController.stopAll()

  console.log('[Main] Closing database...')
  database.logEvent(null, 'app:shutdown')
  database.close()
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindowRef
}
