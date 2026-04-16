#!/usr/bin/env node

// Set up Electron app dependencies when available; skip cleanly for global installs.

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

try {
  require.resolve('electron-builder')
} catch {
  process.exit(0)
}

const root = path.resolve(__dirname, '..')

execSync('electron-builder install-app-deps', { stdio: 'inherit', cwd: root })

// Rebrand Electron.app → Orchestrator.app for dev mode on macOS.
// Patches the Info.plist (name + icon), copies our .icns, renames the .app
// bundle, and updates path.txt so the electron module resolves the new path.
if (process.platform === 'darwin') {
  const dist = path.join(root, 'node_modules/electron/dist')
  const oldApp = path.join(dist, 'Electron.app')
  const newApp = path.join(dist, 'Orchestrator.app')
  const appBundle = fs.existsSync(newApp) ? newApp : oldApp
  const plist = path.join(appBundle, 'Contents/Info.plist')

  if (fs.existsSync(plist)) {
    try {
      execSync(`plutil -replace CFBundleName -string Orchestrator "${plist}"`)
      execSync(`plutil -replace CFBundleDisplayName -string Orchestrator "${plist}"`)
      execSync(`plutil -replace CFBundleIconFile -string orchestrator.icns "${plist}"`)
      fs.copyFileSync(
        path.join(root, 'resources/icon.icns'),
        path.join(appBundle, 'Contents/Resources/orchestrator.icns')
      )

      if (fs.existsSync(oldApp)) {
        fs.renameSync(oldApp, newApp)
      }

      const pathFile = path.join(root, 'node_modules/electron/path.txt')
      fs.writeFileSync(pathFile, 'Orchestrator.app/Contents/MacOS/Electron')

      console.log('[postinstall] Rebranded Electron.app → Orchestrator.app')
    } catch (err) {
      console.warn('[postinstall] Failed to rebrand Electron.app:', err.message)
    }
  }
}
