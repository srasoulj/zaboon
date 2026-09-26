/**
 * Serves the service worker (/serwist/sw.js and its source map), bundled from app/sw.ts by
 * @serwist/turbopack's createSerwistRoute with the native esbuild (a direct dependency of
 * @zaboon/web and a server-external package in next.config.ts; esbuild-wasm is not installed).
 * Static: built once per deployment. The precache holds the hashed build output, the small public
 * files (icons, sound sprite) and the offline page.
 */
import { randomUUID } from 'node:crypto'
import { createSerwistRoute } from '@serwist/turbopack'
import { contentBaseOf } from '@/components/pages/sw-matchers'
import { contentBaseUrlFromEnv } from '@/lib/content-base-url'

// A new revision per build, so a deployment refreshes the precached offline page.
const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? randomUUID()

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: 'app/sw.ts',
    useNativeEsbuild: true,
    additionalPrecacheEntries: [{ url: '/~offline', revision }],
    // Course content is cached at runtime per version (sw.ts), never precached wholesale.
    globIgnores: ['public/content/**'],
    // The worker may cache course media below /content/ here and below the content base only
    // (CONTENT_BASE_URL, else the Supabase project's content bucket: lib/content-base-url.ts).
    esbuildOptions: {
      define: {
        __ZABOON_CONTENT_BASE__: JSON.stringify(
          contentBaseOf(contentBaseUrlFromEnv(process.env)) ?? '',
        ),
      },
    },
  },
)
