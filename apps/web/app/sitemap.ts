import type { MetadataRoute } from 'next'
import { PERSIAN_ALPHABET } from '@/components/pages/alphabet'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

/** /sitemap.xml: the static marketing pages and one page per letter. */
export default function sitemap(): MetadataRoute.Sitemap {
  const url = (path: string) => new URL(path, SITE_URL).toString()
  return [
    { url: url('/'), changeFrequency: 'weekly', priority: 1 },
    { url: url('/learn-persian'), changeFrequency: 'monthly', priority: 0.8 },
    { url: url('/alphabet'), changeFrequency: 'monthly', priority: 0.8 },
    ...PERSIAN_ALPHABET.map((l) => ({
      url: url(`/alphabet/${l.slug}`),
      changeFrequency: 'yearly' as const,
      priority: 0.6,
    })),
  ]
}
