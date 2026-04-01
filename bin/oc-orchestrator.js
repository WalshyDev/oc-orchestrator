#!/usr/bin/env node

const { spawn } = require('child_process')
const path = require('path')

// Resolve the electron binary from the package's own dependencies
const electronPath = require('electron')
const appPath = path.resolve(__dirname, '..')

const child = spawn(electronPath, [appPath], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }
})

child.on('close', (code) => {
  process.exit(code ?? 0)
})
