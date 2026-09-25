import type { Metadata } from 'next'
import Link from 'next/link'
import { Persian } from '@/components/pages/Persian'
import { ButtonLink } from '@/components/pages/ButtonLink'
import { ZaBadge } from '@/components/pages/ZaBadge'

export const metadata: Metadata = {
  title: { absolute: 'Zaboon: learn Persian (Farsi), free and fun' },
  description:
    'Learn Persian (Farsi) with short, playful lessons: speak, listen and read the Persian alphabet. Start in seconds, no account needed.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Zaboon: learn Persian (Farsi)',
    description: 'Short, playful lessons to speak, listen and read Persian.',
    type: 'website',
    url: '/',
  },
}

const FEATURES = [
  {
    title: 'Bite-sized lessons',
    body: 'Five minutes a day is enough. Tap, listen and build sentences you can use right away.',
  },
  {
    title: 'Read the script',
    body: 'Learn the 32 letters step by step, starting with the ones that never change shape.',
  },
  {
    title: 'Keep your streak',
    body: 'Daily goals, XP and streaks keep you coming back, and review brings back what you forget.',
  },
] as const

export default function Home() {
  return (
    <>
      <section className="mx-auto flex w-full max-w-5xl flex-col items-center gap-10 px-4 py-14 tablet:flex-row tablet:py-20">
        <div className="flex flex-1 justify-center">
          <div className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border-2 border-b-4 border-line p-8">
            <ZaBadge size={120} />
            <Persian as="p" className="text-5xl">
              سلام
            </Persian>
            <p className="text-stone">
              <span className="font-bold text-ink">salām</span>: hello
            </p>
          </div>
        </div>
        <div className="flex flex-1 flex-col items-center gap-6 text-center tablet:items-start tablet:text-start">
          <h1 className="text-4xl font-black tracking-tight desktop:text-5xl">
            The fun, free way to learn Persian (Farsi) with Zaboon
          </h1>
          <p className="text-lg text-stone">
            Short lessons, real conversations and the Persian alphabet, for heritage learners,
            partners, travellers and poetry lovers.
          </p>
          <div className="flex w-full max-w-sm flex-col gap-3">
            <ButtonLink href="/onboarding" fullWidth>
              Get started
            </ButtonLink>
            <ButtonLink href="/sign-in" variant="ghost" fullWidth>
              I already have an account
            </ButtonLink>
          </div>
        </div>
      </section>

      <section aria-labelledby="why" className="bg-surface">
        <div className="mx-auto w-full max-w-5xl px-4 py-14">
          <h2 id="why" className="mb-8 text-center text-3xl font-extrabold">
            Why learn with Zaboon?
          </h2>
          <ul className="grid gap-4 tablet:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="rounded-[var(--radius-card)] border-2 border-b-4 border-line bg-bg p-6">
                <h3 className="mb-2 text-xl font-extrabold">{f.title}</h3>
                <p className="text-stone">{f.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="alphabet" className="mx-auto w-full max-w-5xl px-4 py-14 text-center">
        <h2 id="alphabet" className="mb-4 text-3xl font-extrabold">
          Start with the alphabet
        </h2>
        <p className="mx-auto mb-6 max-w-xl text-stone">
          Persian is written right to left with 32 letters. Most letters join the next one and change
          shape as they do. See every letter, its sound and its four forms.
        </p>
        <Link
          href="/alphabet"
          className="font-extrabold text-lajvard-500 underline underline-offset-4 dark:text-ink"
        >
          Explore the Persian alphabet
        </Link>
      </section>
    </>
  )
}
