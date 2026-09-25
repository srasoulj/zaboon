/**
 * What the service worker may cache (ARCHITECTURE §12): ONLY immutable things.
 *
 * - hashed app assets: same-origin `/_next/static/…` (Next puts a content hash in every file name);
 * - course media: `/content/<course>/assets/…/<name>.<10-hex hash>.<ext>` (what lesson audio and
 *   images resolve to: the manifests' `assetsBase` is "../assets/", see lib/server/content.ts
 *   `mediaUrl`), and the versioned bundles `/content/<course>/v<N>/…`. Both never change once
 *   published. They come from this origin or the configured content origin (CONTENT_BASE_URL),
 *   never from anywhere else.
 *
 * Never cached: `/api/*` (game state, auth), pages and RSC payloads (they depend on the signed-in
 * learner), the auth endpoints, and anything that isn't a GET. Kept free of Serwist and DOM types so
 * it is unit-testable in Node.
 */

export interface CacheCandidate {
  url: URL
  method: string
  sameOrigin: boolean
  /** Other origins that serve course content (the CONTENT_BASE_URL origin), if any. */
  contentOrigins?: readonly string[]
}

export type CacheBucket = 'app-assets' | 'content'

/** `…/content/<course>/assets/<dir…>/<name>.<10-hex>.<ext>` (the name may contain dots). */
const HASHED_MEDIA = /\/content\/[a-z0-9-]+\/assets\/(?:[^/]+\/)*[^/]+\.[0-9a-f]{10}\.[a-z0-9]+$/
/** `…/content/<course>/v<N>/<file>`: a published bundle version. */
const VERSIONED_BUNDLE = /\/content\/[a-z0-9-]+\/v\d+\/[^/]+(?:\/[^/]+)*$/
const NEVER = [/^\/api(\/|$)/, /^\/auth(\/|$)/, /^\/serwist(\/|$)/]

export function isHashedAppAsset({
  url,
  sameOrigin,
}: Pick<CacheCandidate, 'url' | 'sameOrigin'>): boolean {
  return sameOrigin && url.pathname.startsWith('/_next/static/') && url.search === ''
}

export function isImmutableContent({
  url,
  sameOrigin,
  contentOrigins = [],
}: Pick<CacheCandidate, 'url' | 'sameOrigin' | 'contentOrigins'>): boolean {
  if (!sameOrigin && !contentOrigins.includes(url.origin)) return false
  if (url.search !== '') return false
  return HASHED_MEDIA.test(url.pathname) || VERSIONED_BUNDLE.test(url.pathname)
}

/** The runtime cache a request belongs in, or null when it must always go to the network. */
export function cacheBucket(candidate: CacheCandidate): CacheBucket | null {
  if (candidate.method.toUpperCase() !== 'GET') return null
  if (candidate.sameOrigin && NEVER.some((re) => re.test(candidate.url.pathname))) return null
  if (isHashedAppAsset(candidate)) return 'app-assets'
  if (isImmutableContent(candidate)) return 'content'
  return null
}

/** Cache names (bump the suffix to drop old caches after a format change). */
export const CACHE_NAMES: Record<CacheBucket, string> = {
  'app-assets': 'zaboon-app-assets-v1',
  content: 'zaboon-content-v1',
}

/** The page served when a navigation fails offline. */
export const OFFLINE_URL = '/~offline'

/** The origin of CONTENT_BASE_URL, or null when content is served by the app itself. */
export function contentOriginOf(contentBaseUrl: string | undefined | null): string | null {
  if (!contentBaseUrl) return null
  try {
    return new URL(contentBaseUrl).origin
  } catch {
    return null
  }
}
