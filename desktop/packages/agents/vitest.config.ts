import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@lingbo/agents',
    include: ['src/**/*.test.ts'],
  },
})
