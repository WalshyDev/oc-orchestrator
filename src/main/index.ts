import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { agentController } from './services/agent-controller'
import { database } from './services/database'
import { runtimeManager } from './services/runtime-manager'

let mainWindowRef: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(async () => {
  // Initialize the database (constructor runs migrations)
  console.log('[Main] Database initialized')
  database.logEvent(null, 'app:started')

  registerIpcHandlers()

  await agentController.restorePersistedAgents()
  console.log('[Main] Restored persisted agents')

  mainWindowRef = createWindow()

  // Start runtime health checks after window creation
  runtimeManager.startHealthChecks()
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
  agentController.stopAll()

  console.log('[Main] Closing database...')
  database.logEvent(null, 'app:shutdown')
  database.close()
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindowRef
}
