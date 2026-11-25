import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
}

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
        },
      },
      {
        // Needs the local Supabase stack: `npx supabase start`.
        resolve: { alias },
        test: {
          name: 'db',
          environment: 'node',
          include: ['tests/db/**/*.test.ts'],
          setupFiles: ['tests/db/setup.ts'],
          // These tests share one database, so run files one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
})
