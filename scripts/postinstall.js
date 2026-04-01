#!/usr/bin/env node

// In dev, run electron-builder install-app-deps to set up native modules.
// For global npm installs, skip gracefully (no native modules to rebuild).

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
