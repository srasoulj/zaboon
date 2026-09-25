/**
 * What the service worker may cache (ARCHITECTURE §12): ONLY immutable things.
 *
 * - hashed app assets: same-origin `/_next/static/…` (Next puts a content hash in every file name);
 * - course media: `/content/<course>/assets/…/<name>.<10-hex hash>.<ext>` (what lesson audio and
 *   images resolve to: the manifests' `assetsBase` is "../assets/", see lib/server/content.ts
 *   `mediaUrl`), and the versioned bundles `/content/<course>/v<N>/…`. Both never change once
 *   published. They are matched below exactly one base: `/content/` on this origin, or the
 *   configured CONTENT_BASE_URL (its origin AND its path prefix), never anywhere else.
 *
 * Never cached: `/api/*` (game state, auth), pages and RSC payloads (they depend on the signed-in
 * learner), the auth endpoints, and anything that isn't a GET. Kept free of Serwist and DOM types so
 * it is unit-testable in Node.
 */

export interface CacheCandidate {
  url: URL
  method: string
  sameOrigin: boolean
  /** Absolute CONTENT_BASE_URL-style bases that serve course content (normalized), if any. */
  contentBases?: readonly string[]
}

export type CacheBucket = 'app-assets' | 'content'

// Paths relative to a content base (lib/server/content.ts mediaUrl: `${base}/${rel}`).
/** `<course>/assets/<dir…>/<name>.<10-hex>.<ext>` (the name may contain dots). */
const HASHED_MEDIA = /^[a-z0-9-]+\/assets\/(?:[^/]+\/)*[^/]+\.[0-9a-f]{10}\.[a-z0-9]+$/
/** `<course>/v<N>/<file…>`: a published bundle version. */
const VERSIONED_BUNDLE = /^[a-z0-9-]+\/v\d+\/[^/]+(?:\/[^/]+)*$/
/** Without CONTENT_BASE_URL the app serves content itself, under this prefix. */
const SAME_ORIGIN_CONTENT = '/content/'
const NEVER = [/^\/api(\/|$)/, /^\/auth(\/|$)/, /^\/serwist(\/|$)/]

export function isHashedAppAsset({
  url,
  sameOrigin,
}: Pick<CacheCandidate, 'url' | 'sameOrigin'>): boolean {
  return sameOrigin && url.pathname.startsWith('/_next/static/') && url.search === ''
}

/** The path below a content base (`/content/` here, or a configured base), or null. */
function contentPath({
  url,
  sameOrigin,
  contentBases = [],
}: Pick<CacheCandidate, 'url' | 'sameOrigin' | 'contentBases'>): string | null {
  if (sameOrigin && url.pathname.startsWith(SAME_ORIGIN_CONTENT))
    return url.pathname.slice(SAME_ORIGIN_CONTENT.length)
  for (const base of contentBases) {
    const b = new URL(base)
    const prefix = b.pathname.endsWith('/') ? b.pathname : `${b.pathname}/`
    if (url.origin === b.origin && url.pathname.startsWith(prefix))
      return url.pathname.slice(prefix.length)
  }
  return null
}

export function isImmutableContent(
  candidate: Pick<CacheCandidate, 'url' | 'sameOrigin' | 'contentBases'>,
): boolean {
  if (candidate.url.search !== '') return false
  const rel = contentPath(candidate)
  return rel !== null && (HASHED_MEDIA.test(rel) || VERSIONED_BUNDLE.test(rel))
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

/** CONTENT_BASE_URL normalized for the worker (origin + path, no trailing slash), or null. */
export function contentBaseOf(contentBaseUrl: string | undefined | null): string | null {
  if (!contentBaseUrl) return null
  try {
    const u = new URL(contentBaseUrl)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}
