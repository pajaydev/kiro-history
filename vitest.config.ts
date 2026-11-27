import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Only run source tests, never stale compiled copies in dist/.
    include: ['server/**/*.test.ts'],
  },
})
