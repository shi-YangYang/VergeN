import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  envDir: path.resolve('config/env'),
  resolve: {
    alias: {
      '@': path.resolve('./src'),
      '@root': path.resolve('.'),
    },
  },
  define: {
    OS_PLATFORM: `"${process.platform}"`,
  },
  test: {
    include: ['src/**/*.test.ts', 'server/web/src/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
})
