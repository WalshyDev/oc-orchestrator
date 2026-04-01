#!/usr/bin/env node

// Set up Electron app dependencies when available; skip cleanly for global installs.

const { execSync } = require('child_process')

try {
  require.resolve('electron-builder')
} catch {
  process.exit(0)
}

execSync('electron-builder install-app-deps', {
  stdio: 'inherit',
  cwd: require('path').resolve(__dirname, '..')
})
