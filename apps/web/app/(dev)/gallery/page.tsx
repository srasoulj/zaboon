import type { Metadata } from 'next'
import { Nunito, Vazirmatn } from 'next/font/google'
import { notFound } from 'next/navigation'
import { Gallery } from './gallery'
import styles from './gallery.module.css'

// Fonts are loaded here only (the root layout is orchestrator-owned). next/font sets the
// token variables directly, so every component's var(--font-latin/--font-persian) picks them up.
const nunito = Nunito({ subsets: ['latin'], variable: '--font-latin', display: 'swap' })
const vazirmatn = Vazirmatn({ subsets: ['arabic', 'latin'], variable: '--font-persian', display: 'swap' })

export const metadata: Metadata = {
  title: 'UI gallery · Zaboon',
  robots: { index: false, follow: false },
}

type Theme = 'light' | 'dark'

/** Dev-only component gallery for @zaboon/ui. `?theme=dark` renders the dark tokens. */
export default async function GalleryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === 'production' && process.env.ZABOON_DEV_AUTH !== '1') notFound()
  const { theme: raw } = await searchParams
  const theme: Theme = raw === 'dark' ? 'dark' : 'light'
  return (
    <div data-theme={theme} className={`${nunito.variable} ${vazirmatn.variable} ${styles.root}`}>
      <Gallery theme={theme} />
    </div>
  )
}
