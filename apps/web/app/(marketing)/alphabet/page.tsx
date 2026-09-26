import type { Metadata } from 'next'
import Link from 'next/link'
import { PERSIAN_ALPHABET } from '@/components/pages/alphabet'
import { Persian } from '@/components/pages/Persian'

export const metadata: Metadata = {
  title: 'The Persian alphabet: all 32 letters',
  description:
    'The Persian (Farsi) alphabet: all 32 letters with their names, sounds and the four shapes each letter takes, with an example word for each.',
  alternates: { canonical: '/alphabet' },
  openGraph: { title: 'The Persian alphabet: all 32 letters', url: '/alphabet' },
}

export default function AlphabetPage() {
  return (
    <article className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-black tracking-tight">The Persian alphabet</h1>
        <p className="max-w-3xl text-lg text-stone">
          Persian (Farsi) is written from right to left with 32 letters. Most letters join the
          letter after them and change shape as they do; seven never join the next letter. Pick a
          letter to see its sound, its four forms and an example word.
        </p>
      </header>
      <ul className="grid grid-cols-3 gap-3 tablet:grid-cols-6 desktop:grid-cols-8" dir="rtl">
        {PERSIAN_ALPHABET.map((l) => (
          <li key={l.slug}>
            <Link
              href={`/alphabet/${l.slug}`}
              className="flex flex-col items-center gap-1 rounded-[var(--radius-card)] border-2 border-b-4 border-line p-3 hover:bg-surface"
              dir="ltr"
            >
              <Persian className="text-4xl">{l.letter}</Persian>
              <span className="font-extrabold">{l.name}</span>
              <span className="text-sm text-stone">{l.translit}</span>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  )
}
