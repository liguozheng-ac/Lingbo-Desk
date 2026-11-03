import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@lingbo/core-agent',
    include: ['src/**/*.test.ts'],
  },
})
