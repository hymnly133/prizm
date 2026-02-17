import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'prizm/src/**/*.test.ts',
      'prizm-client-core/src/**/*.test.ts',
      'packages/*/src/**/*.test.ts'
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/references/**',
      '**/research/**',
      '**/EverMemOS/**',
      '**/docs/**'
    ],
    setupFiles: ['./prizm/vitest.setup.ts']
  }
})
