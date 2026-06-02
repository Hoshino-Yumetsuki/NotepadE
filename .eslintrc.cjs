/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  settings: {
    react: { version: 'detect' },
  },
  env: {
    es2022: true,
    node: true,
    browser: true,
  },
  ignorePatterns: [
    'node_modules/',
    'out/',
    'dist/',
    '.vite/',
    'coverage/',
    'playwright-report/',
    'test/fixtures/**',
  ],
  rules: {
    'react/react-in-jsx-scope': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
  overrides: [
    {
      // PA-8 defense-in-depth: renderer must never import Node built-ins.
      files: ['src/renderer/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              { name: 'fs', message: 'PA-8: no fs in renderer; use window.notepads.' },
              { name: 'node:fs', message: 'PA-8: no fs in renderer; use window.notepads.' },
              {
                name: 'child_process',
                message: 'PA-8: no child_process in renderer; use window.notepads.',
              },
              {
                name: 'node:child_process',
                message: 'PA-8: no child_process in renderer; use window.notepads.',
              },
              { name: 'path', message: 'PA-8: no path in renderer; use window.notepads.' },
              { name: 'node:path', message: 'PA-8: no path in renderer; use window.notepads.' },
              { name: 'electron', message: 'PA-8: renderer talks only to window.notepads.' },
            ],
          },
        ],
      },
    },
  ],
};
