import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Three projects:
// - unit: pure TS tests (`*.test.ts`), node environment
// - dom:  React component tests (`*.test.tsx`), jsdom environment
// - db:   integration tests against local Postgres (`*.db.test.ts`); run with `pnpm test:db`
const shared = {
  exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**', 'e2e/**'],
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['{packages,tools,apps}/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: [...shared.exclude, '**/*.db.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['{packages,apps}/**/*.test.tsx'],
          exclude: shared.exclude,
          setupFiles: ['./vitest.setup.dom.ts'],
        },
      },
      {
        test: {
          name: 'db',
          environment: 'node',
          include: ['**/*.db.test.ts'],
          exclude: shared.exclude,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
