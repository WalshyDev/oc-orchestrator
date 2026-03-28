import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: true
  },
  resolve: {
    alias: {
      '@': '/src/renderer/src'
    }
  }
})
