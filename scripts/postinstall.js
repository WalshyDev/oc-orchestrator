#!/usr/bin/env node

// Only run native module rebuilds in dev (when electron-builder is available).
// Global npm installs don't have devDependencies, so skip gracefully.

const { execSync } = require('child_process')

try {
  require.resolve('electron-builder')
} catch {
  // Not in dev — nothing to rebuild
  process.exit(0)
}

execSync('electron-builder install-app-deps && electron-rebuild -f -w better-sqlite3', {
  stdio: 'inherit',
  cwd: require('path').resolve(__dirname, '..')
})
