import { app, shell, BrowserWindow, nativeImage, Menu } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { agentController } from './services/agent-controller'
import { database } from './services/database'
import { runtimeManager } from './services/runtime-manager'
import { startUpdateChecker, stopUpdateChecker } from './services/update-checker'

// Pin userData path before setName — otherwise it shifts to ~/Library/Application Support/Orchestrator/
const userDataPath = app.getPath('userData')
app.setName('Orchestrator')
app.setPath('userData', userDataPath)

let mainWindowRef: BrowserWindow | null = null

const WINDOW_BOUNDS_KEY = 'window_bounds'
const DEFAULT_WIDTH = 1440
const DEFAULT_HEIGHT = 900

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
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
}

function saveWindowBounds(window: BrowserWindow): void {
  const maximized = window.isMaximized()
  const bounds = maximized ? window.getNormalBounds() : window.getBounds()
  database.setPreference(WINDOW_BOUNDS_KEY, JSON.stringify({ ...bounds, maximized }))
}

function applySavedBounds(window: BrowserWindow): void {
  const saved = loadWindowBounds()
  if (saved.x !== undefined && saved.y !== undefined) {
    window.setBounds({ x: saved.x, y: saved.y, width: saved.width, height: saved.height })
  } else if (saved.width !== DEFAULT_WIDTH || saved.height !== DEFAULT_HEIGHT) {
    window.setSize(saved.width, saved.height)
  }
  if (saved.maximized) window.maximize()
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    icon: getAppIcon(),
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: 1024,
    minHeight: 680,
    show: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
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
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Orchestrator',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            for (const win of BrowserWindow.getAllWindows()) {
              win.webContents.send('menu:open-settings')
            }
          }
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ]
    },
    { role: 'windowMenu' },
  ]))

  // Set dock icon (macOS dev mode)
  const appIcon = getAppIcon()
  if (appIcon && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(appIcon)
  }

  registerIpcHandlers()

  // Create the window before DB init so the UI appears immediately.
  mainWindowRef = createWindow()

  await database.init()
  console.log('[Main] Database initialized')
  database.logEvent(null, 'app:started')
  applySavedBounds(mainWindowRef)

  runtimeManager.startHealthChecks()
  agentController.startIdleRuntimeChecks()
  startUpdateChecker()

  // Restore agents after the renderer has loaded so the window appears
  // with the loading indicator before we start spawning runtimes.
  // If did-finish-load already fired while awaiting DB init, start immediately.
  const startRestore = (): void => {
    agentController.restorePersistedAgents().then(() => {
      console.log('[Main] Restored persisted agents')
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('agents:restored')
      }
    })
  }

  if (!mainWindowRef.webContents.isLoading()) {
    startRestore()
  } else {
    mainWindowRef.webContents.once('did-finish-load', startRestore)
  }

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
