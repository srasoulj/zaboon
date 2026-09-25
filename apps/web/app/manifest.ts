import type { MetadataRoute } from 'next'
import rawTokens from '@zaboon/ui/tokens.json'

// Colors come from the design tokens (packages/ui/tokens.json), never hard-coded.
const tokens = rawTokens as {
  color: {
    brand: { firouzeh: { '500': { $value: string } } }
    light: { bg: { $value: string } }
  }
}

/** The web app manifest (/manifest.webmanifest): installable, opens on the learning path. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Zaboon: learn Persian (Farsi)',
    short_name: 'Zaboon',
    description: 'A playful way to learn Persian (Farsi), one bite-sized lesson at a time.',
    start_url: '/learn',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'en',
    dir: 'ltr',
    categories: ['education'],
    background_color: tokens.color.light.bg.$value,
    theme_color: tokens.color.brand.firouzeh['500'].$value,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
