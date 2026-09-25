/**
 * Serves the service worker (/serwist/sw.js and its source map), bundled from app/sw.ts with the
 * native esbuild (esbuild-wasm is not installed; next.config keeps esbuild external). Static:
 * built once per deployment. The precache holds the hashed build output plus the offline page.
 */
import { randomUUID } from 'node:crypto'
import { createSerwistRoute } from '@serwist/turbopack'

// A new revision per build, so a deployment refreshes the precached offline page.
const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? randomUUID()

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: 'app/sw.ts',
  useNativeEsbuild: true,
  additionalPrecacheEntries: [{ url: '/~offline', revision }],
})
