import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ButtonLink } from '@/components/pages/ButtonLink'
import { Persian } from '@/components/pages/Persian'
import {
  PERSIAN_ALPHABET,
  letterByChar,
  letterBySlug,
  neighbors,
} from '@/components/pages/alphabet'

// One static page per letter; anything else is a 404.
export const dynamicParams = false

export function generateStaticParams(): { letter: string }[] {
  return PERSIAN_ALPHABET.map((l) => ({ letter: l.slug }))
}

type Props = { params: Promise<{ letter: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const l = letterBySlug((await params).letter)
  if (!l) return {}
  const title = `${l.name} (${l.letter}): the Persian letter ${l.translit}`
  return {
    title,
    description: `How to read, write and say the Persian (Farsi) letter ${l.name} (${l.letter}): its sound, its four forms and an example word.`,
    alternates: { canonical: `/alphabet/${l.slug}` },
    openGraph: { title, url: `/alphabet/${l.slug}` },
  }
}

const FORM_LABELS = [
  ['isolated', 'On its own'],
  ['initial', 'At the start of a word'],
  ['medial', 'In the middle'],
  ['final', 'At the end'],
] as const

export default async function LetterPage({ params }: Props) {
  const l = letterBySlug((await params).letter)
  const around = l ? neighbors(l.slug) : null
  if (!l || !around) notFound()
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-12">
      <nav aria-label="Breadcrumb" className="font-bold text-stone">
        <Link href="/alphabet" className="underline underline-offset-4">
          The Persian alphabet
        </Link>{' '}
        <span aria-hidden="true">›</span> {l.name}
      </nav>

      <header className="flex flex-col items-center gap-6 tablet:flex-row">
        <div className="flex size-40 shrink-0 items-center justify-center rounded-[var(--radius-card)] border-2 border-b-4 border-line">
          <Persian className="text-8xl">{l.letter}</Persian>
        </div>
        <div className="flex flex-col gap-2 text-center tablet:text-start">
          <h1 className="text-4xl font-black tracking-tight">
            The letter {l.name} (<Persian>{l.letter}</Persian>)
          </h1>
          <p className="text-lg">
            Letter {l.order} of 32 · sounds like <strong>{l.translit}</strong>{' '}
            <span className="text-stone">/{l.ipa}/</span>
          </p>
          <p className="text-stone">{l.sound}</p>
        </div>
      </header>

      <section aria-labelledby="forms" className="flex flex-col gap-3">
        <h2 id="forms" className="text-2xl font-extrabold">
          Its four forms
        </h2>
        <p className="text-stone">
          {l.connects
            ? `${l.name} joins the letters on both sides, so its shape changes with its position in a word.`
            : `${l.name} never joins the letter after it, so its initial form is the same as on its own, and the letter after it starts afresh.`}
        </p>
        <dl className="grid grid-cols-2 gap-3 tablet:grid-cols-4">
          {FORM_LABELS.map(([key, label]) => (
            <div
              key={key}
              className="flex flex-col-reverse items-center gap-2 rounded-[var(--radius-card)] border-2 border-line p-4"
            >
              <dt className="text-center text-sm font-bold text-stone">{label}</dt>
              <dd>
                <Persian className="text-5xl">{l.forms[key]}</Persian>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="example" className="flex flex-col gap-3">
        <h2 id="example" className="text-2xl font-extrabold">
          Example word
        </h2>
        <div className="flex items-center justify-between gap-4 rounded-[var(--radius-card)] border-2 border-b-4 border-line p-5">
          <span>
            <span className="block text-xl font-bold">{l.example.translit}</span>
            <span className="text-stone">{l.example.en}</span>
          </span>
          <Persian className="text-4xl">{l.example.fa}</Persian>
        </div>
        {l.sameSoundAs.length > 0 && (
          <p className="text-stone">
            Sounds the same as{' '}
            {l.sameSoundAs.map((ch, i) => {
              const other = letterByChar(ch)!
              return (
                <span key={ch}>
                  {i > 0 && (i === l.sameSoundAs.length - 1 ? ' and ' : ', ')}
                  <Link
                    href={`/alphabet/${other.slug}`}
                    className="font-bold text-lajvard-500 underline dark:text-ink"
                  >
                    {other.name} (<Persian>{ch}</Persian>)
                  </Link>
                </span>
              )
            })}
            : you learn which one a word uses as you learn the word.
          </p>
        )}
      </section>

      <nav aria-label="Letters" className="flex justify-between gap-4 font-extrabold">
        <Link href={`/alphabet/${around.prev.slug}`} className="text-lajvard-500 dark:text-ink">
          ‹ {around.prev.name}
        </Link>
        <Link href={`/alphabet/${around.next.slug}`} className="text-lajvard-500 dark:text-ink">
          {around.next.name} ›
        </Link>
      </nav>

      <section className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] bg-surface p-8 text-center">
        <h2 className="text-2xl font-extrabold">Learn to read Persian</h2>
        <p>Short lessons teach every letter, with sounds and real words.</p>
        <div className="w-full max-w-sm">
          <ButtonLink href="/onboarding" fullWidth>
            Get started
          </ButtonLink>
        </div>
      </section>
    </article>
  )
}
