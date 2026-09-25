/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/**
 * The Serwist service worker (ARCHITECTURE §12), bundled by app/serwist/[path]/route.ts and served at
 * /serwist/sw.js. It caches ONLY immutable things: hashed app assets, hashed course media and
 * versioned course bundles (components/pages/sw-matchers.ts). The API, pages and auth always go to the network; a failed
 * navigation shows the precached offline page. The lesson outbox lives in the page, not here.
 */
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from 'serwist'
import { CacheFirst, ExpirationPlugin, NetworkOnly, RangeRequestsPlugin, Serwist } from 'serwist'
import { CACHE_NAMES, OFFLINE_URL, cacheBucket } from '../components/pages/sw-matchers'

// The CONTENT_BASE_URL origin, inlined at bundle time by app/serwist/[path]/route.ts ('' = same origin).
declare const __ZABOON_CONTENT_ORIGIN__: string
const contentOrigins = __ZABOON_CONTENT_ORIGIN__ ? [__ZABOON_CONTENT_ORIGIN__] : []

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Filled in by Serwist at build time (the hashed files under .next/static plus the offline page).
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const YEAR_SECONDS = 365 * 24 * 60 * 60

const runtimeCaching: RuntimeCaching[] = [
  {
    matcher: ({ url, request, sameOrigin }) =>
      cacheBucket({ url, method: request.method, sameOrigin, contentOrigins }) === 'app-assets',
    handler: new CacheFirst({
      cacheName: CACHE_NAMES['app-assets'],
      plugins: [new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: YEAR_SECONDS })],
    }),
  },
  {
    matcher: ({ url, request, sameOrigin }) =>
      cacheBucket({ url, method: request.method, sameOrigin, contentOrigins }) === 'content',
    handler: new CacheFirst({
      cacheName: CACHE_NAMES.content,
      plugins: [
        new ExpirationPlugin({ maxEntries: 1000, maxAgeSeconds: YEAR_SECONDS }),
        new RangeRequestsPlugin(),
      ],
    }),
  },
  {
    // Pages are never cached; this route only exists so a failed navigation gets the fallback.
    matcher: ({ request }) => request.mode === 'navigate',
    handler: new NetworkOnly(),
  },
]

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching,
  fallbacks: {
    entries: [{ url: OFFLINE_URL, matcher: ({ request }) => request.destination === 'document' }],
  },
})

serwist.addEventListeners()
