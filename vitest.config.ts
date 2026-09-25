import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Three projects:
// - unit: pure TS tests (`*.test.ts`), node environment
// - dom:  React component tests (`*.test.tsx`), jsdom environment
// - db:   integration tests against local Postgres (`*.db.test.ts`); run with `pnpm test:db`
const shared = {
  // `.claude/` holds subagents' git worktrees (full repo copies) — never test those.
  exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**', 'e2e/**', '.claude/**'],
}
// The web app's `@/…` import alias (apps/web/tsconfig.json), so tests can import app modules.
const resolve = { alias: { '@': fileURLToPath(new URL('./apps/web', import.meta.url)) } }

export default defineConfig({
  test: {
    projects: [
      {
        resolve,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['{packages,tools,apps}/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: [...shared.exclude, '**/*.db.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['{packages,apps}/**/*.test.tsx'],
          exclude: shared.exclude,
          setupFiles: ['./vitest.setup.dom.ts'],
        },
      },
      {
        resolve,
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
