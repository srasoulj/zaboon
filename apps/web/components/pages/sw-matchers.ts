/**
 * What the service worker may cache (ARCHITECTURE §12): ONLY immutable things.
 *
 * - hashed app assets: same-origin `/_next/static/…` (Next puts a content hash in every file name);
 * - versioned course content and media: `/content/<course>/v<N>/…` (a published version never
 *   changes; the content base may be a CDN, so the path decides, not the origin).
 *
 * Never cached: `/api/*` (game state, auth), pages and RSC payloads (they depend on the signed-in
 * learner), the auth endpoints, and anything that isn't a GET. Kept free of Serwist and DOM types so
 * it is unit-testable in Node.
 */

export interface CacheCandidate {
  url: URL
  method: string
  sameOrigin: boolean
}

export type CacheBucket = 'app-assets' | 'content'

const VERSIONED_CONTENT = /\/content\/[a-z0-9-]+\/v\d+\/[^?#]+$/
const NEVER = [/^\/api(\/|$)/, /^\/auth(\/|$)/, /^\/serwist(\/|$)/]

export function isHashedAppAsset({ url, sameOrigin }: Pick<CacheCandidate, 'url' | 'sameOrigin'>): boolean {
  return sameOrigin && url.pathname.startsWith('/_next/static/') && url.search === ''
}

export function isVersionedContent({ url }: Pick<CacheCandidate, 'url'>): boolean {
  return VERSIONED_CONTENT.test(url.pathname)
}

/** The runtime cache a request belongs in, or null when it must always go to the network. */
export function cacheBucket(candidate: CacheCandidate): CacheBucket | null {
  if (candidate.method.toUpperCase() !== 'GET') return null
  if (candidate.sameOrigin && NEVER.some((re) => re.test(candidate.url.pathname))) return null
  if (isHashedAppAsset(candidate)) return 'app-assets'
  if (isVersionedContent(candidate)) return 'content'
  return null
}

/** Cache names (bump the suffix to drop old caches after a format change). */
export const CACHE_NAMES: Record<CacheBucket, string> = {
  'app-assets': 'zaboon-app-assets-v1',
  content: 'zaboon-content-v1',
}

/** The page served when a navigation fails offline. */
export const OFFLINE_URL = '/~offline'
