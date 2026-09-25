import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Metadata } from 'next'
import { Nunito, Vazirmatn } from 'next/font/google'
import { notFound } from 'next/navigation'
import { Challenge } from '@zaboon/contracts'
import recorded from '@/components/challenges/fixtures/fixture-challenges.json'
import { ChallengeGallery, type GalleryEntry } from './gallery'
import styles from './challenges.module.css'

// Fonts are loaded here only (the root layout is orchestrator-owned), like the UI gallery.
const nunito = Nunito({ subsets: ['latin'], variable: '--font-latin', display: 'swap' })
const vazirmatn = Vazirmatn({
  subsets: ['arabic', 'latin'],
  variable: '--font-persian',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Challenge gallery · Zaboon',
  robots: { index: false, follow: false },
}

const MEDIA_PREFIX = '/media/fixtures/'

/**
 * Fixture pictures are inlined as data URIs: the gallery runs without a published content
 * version, so `/media/fixtures/…` has nothing behind it. Audio stays as URLs (the gallery's audio
 * service only records what would play).
 */
function inlineImage(url: string): string {
  if (!url.startsWith(MEDIA_PREFIX) || !url.endsWith('.svg')) return url
  const file = join(
    process.cwd(),
    '..',
    '..',
    'content',
    'fixtures',
    'assets',
    url.slice(MEDIA_PREFIX.length),
  )
  if (!existsSync(file)) return url
  return `data:image/svg+xml;base64,${readFileSync(file).toString('base64')}`
}

/** The recorded fixture challenges (u01-l1, u01-l2, then the P2 level u01-t1), keyed `<type>-<n>`. */
function entries(): GalleryEntry[] {
  const seen = new Map<string, number>()
  return (recorded as unknown[]).map((raw) => {
    const parsed = Challenge.parse(raw)
    const challenge: Challenge =
      parsed.type === 'select_image'
        ? { ...parsed, choices: parsed.choices.map((c) => ({ ...c, image: inlineImage(c.image) })) }
        : parsed
    const n = seen.get(challenge.type) ?? 0
    seen.set(challenge.type, n + 1)
    return { id: `${challenge.type}-${n}`, challenge }
  })
}

/** P2 challenges (typed Persian, tracing): behind flags in the app, listed after the MVP ones. */
function isP2(c: Challenge): boolean {
  return (
    c.type === 'listen_type' ||
    c.type === 'cloze_type' ||
    c.type === 'letter_trace' ||
    (c.type === 'translate_type' && c.answerLang === 'fa')
  )
}

type Search = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/**
 * Dev-only gallery of every challenge renderer with the fixture course's challenges, in the
 * answering and feedback states. `?theme=dark`, `?only=<id>` (one challenge), `?reduce=1`.
 */
export default async function ChallengeGalleryPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  if (process.env.NODE_ENV === 'production' && process.env.ZABOON_DEV_AUTH !== '1') notFound()
  const params = await searchParams
  const theme = one(params.theme) === 'dark' ? 'dark' : 'light'
  const only = one(params.only)
  const all = entries()
  const shown = only ? all.filter((e) => e.id === only) : all
  if (only && shown.length === 0) notFound()
  return (
    <div data-theme={theme} className={`${nunito.variable} ${vazirmatn.variable} ${styles.root}`}>
      <ChallengeGallery
        entries={shown}
        ids={all.map((e) => e.id)}
        p2Ids={all.filter((e) => isP2(e.challenge)).map((e) => e.id)}
        theme={theme}
        reduceMotion={one(params.reduce) === '1'}
        single={Boolean(only)}
      />
    </div>
  )
}
