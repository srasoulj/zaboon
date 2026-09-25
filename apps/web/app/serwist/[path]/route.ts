/**
 * Serves the service worker (/serwist/sw.js and its source map), bundled from app/sw.ts by
 * @serwist/turbopack's createSerwistRoute with the native esbuild (esbuild-wasm is not installed).
 * Static: built once per deployment. The precache holds the hashed build output, the small public
 * files (icons, sound sprite) and the offline page.
 *
 * Why the indirection: createSerwistRoute does `import("esbuild")` at request/build time, and
 * `esbuild` is not a dependency of @zaboon/web, so from the bundled route it can't be resolved
 * (next build: "Cannot find package 'esbuild'"). Loading @serwist/turbopack natively from its real
 * install directory makes that import resolve to its own esbuild peer. Once `esbuild` is a
 * dependency of apps/web (see the PR's contract change request), this can become the plain
 * `export const { … } = createSerwistRoute({ … })`.
 */
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { createSerwistRoute as CreateSerwistRoute } from '@serwist/turbopack'

export const dynamic = 'force-static'
export const dynamicParams = false
export const revalidate = false

// A new revision per build, so a deployment refreshes the precached offline page.
const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? randomUUID()

type SerwistRoute = ReturnType<typeof CreateSerwistRoute>
let route: Promise<SerwistRoute> | null = null

function serwistRoute(): Promise<SerwistRoute> {
  route ??= (async () => {
    const pkg = realpathSync(join(process.cwd(), 'node_modules/@serwist/turbopack'))
    const mod = (await import(
      /* turbopackIgnore: true */ /* webpackIgnore: true */ pathToFileURL(join(pkg, 'dist/index.mjs')).href
    )) as { createSerwistRoute: typeof CreateSerwistRoute }
    return mod.createSerwistRoute({
      swSrc: 'app/sw.ts',
      useNativeEsbuild: true,
      additionalPrecacheEntries: [{ url: '/~offline', revision }],
      // Course content is cached at runtime per version (sw.ts), never precached wholesale.
      globIgnores: ['public/content/**'],
    })
  })()
  return route
}

export async function generateStaticParams(): Promise<{ path: string }[]> {
  return (await serwistRoute()).generateStaticParams()
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string }> },
): Promise<Response> {
  return (await serwistRoute()).GET(request, context)
}
