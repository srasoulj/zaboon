import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

/** The signed-in app, admin and plumbing: not for crawlers. */
const PRIVATE_ROUTES = [
  '/admin',
  '/lesson',
  '/learn',
  '/letters',
  '/practice',
  '/profile',
  '/settings',
  '/onboarding',
  '/~offline',
] as const

/**
 * Robots rules match by prefix and the longest match wins (RFC 9309), so a bare `/learn` would also
 * block /learn-persian. Each private route is disallowed exactly (`$`), with a query (`?`) and
 * below it (`/`), never as a bare prefix.
 */
function privateRouteRules(route: string): string[] {
  return [`${route}$`, `${route}?`, `${route}/`]
}

/** /robots.txt: the marketing pages are public; the app, the API and admin are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/serwist/', ...PRIVATE_ROUTES.flatMap(privateRouteRules)],
      },
    ],
    sitemap: new URL('/sitemap.xml', SITE_URL).toString(),
  }
}
