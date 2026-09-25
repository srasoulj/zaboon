import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

/** /robots.txt: the marketing pages are public; the app, the API and admin are not for crawlers. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin',
          '/lesson',
          '/learn',
          '/letters',
          '/practice',
          '/profile',
          '/settings',
          '/onboarding',
          '/serwist/',
          '/~offline',
        ],
      },
    ],
    sitemap: new URL('/sitemap.xml', SITE_URL).toString(),
  }
}
