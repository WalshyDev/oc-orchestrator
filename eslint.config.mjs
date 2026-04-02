import js from '@eslint/js'
import tsParser from '@typescript-eslint/parser'
import globals from 'globals'

export default [
  {
    ignores: ['out/', 'node_modules/', '**/*.js'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tsParser,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      'no-undef': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      'quotes': ['warn', 'single', { avoidEscape: true }],
      'no-var': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-console': 'warn',
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/**/*.d.ts'],
    rules: {
      'no-unused-vars': 'off',
    },
  },
]
