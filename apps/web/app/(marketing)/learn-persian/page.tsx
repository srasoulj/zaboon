import type { Metadata } from 'next'
import Link from 'next/link'
import { ButtonLink } from '@/components/pages/ButtonLink'
import { Persian } from '@/components/pages/Persian'

export const metadata: Metadata = {
  title: 'Learn Persian (Farsi) online',
  description:
    'How to learn Persian (Farsi) as an English speaker: the alphabet, pronunciation, everyday phrases and a daily habit, in short free lessons.',
  alternates: { canonical: '/learn-persian' },
  openGraph: { title: 'Learn Persian (Farsi) online with Zaboon', url: '/learn-persian' },
}

const PHRASES = [
  { fa: 'سلام', translit: 'salām', en: 'hello' },
  { fa: 'مرسی', translit: 'mersi', en: 'thanks' },
  { fa: 'خوبی؟', translit: 'khubi?', en: 'how are you? (informal)' },
  { fa: 'خداحافظ', translit: 'khodāhāfez', en: 'goodbye' },
] as const

const FAQ = [
  {
    q: 'Is Persian the same as Farsi?',
    a: 'Yes. Farsi is the name of the language in Persian; in English it is usually called Persian. It is spoken in Iran, Afghanistan (as Dari) and Tajikistan (as Tajik), and by a large diaspora.',
  },
  {
    q: 'Is Persian hard to learn for English speakers?',
    a: 'Persian grammar is friendly: no grammatical gender, regular verbs and a simple present tense. The new part is the script, and it has only 32 letters.',
  },
  {
    q: 'Do I need to learn the alphabet first?',
    a: "No. Zaboon shows transliteration while a word is new and teaches the letters alongside. If you already speak Persian but can't read it, you can start with the letters.",
  },
  {
    q: 'Does Zaboon teach spoken or written Persian?',
    a: 'Both. You learn the everyday spoken forms people really use, and see the formal written form next to them.',
  },
] as const

export default function LearnPersianPage() {
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-12">
      <header className="flex flex-col gap-4">
        <h1 className="text-4xl font-black tracking-tight">Learn Persian (Farsi) online</h1>
        <p className="text-lg text-stone">
          Persian is the language of Rumi and Hafez, of Nowruz and of more than 100 million
          speakers. Zaboon teaches it in short daily lessons you can start right now, for free.
        </p>
        <div className="max-w-sm">
          <ButtonLink href="/onboarding" fullWidth>
            Start learning
          </ButtonLink>
        </div>
      </header>

      <section aria-labelledby="how" className="flex flex-col gap-3">
        <h2 id="how" className="text-2xl font-extrabold">
          How Zaboon teaches Persian
        </h2>
        <ul className="flex list-disc flex-col gap-2 ps-6">
          <li>
            <strong>Short lessons</strong> of about a dozen quick exercises: pick, tap, listen and
            type.
          </li>
          <li>
            <strong>The alphabet, step by step</strong>, starting with the letters that never join
            the next letter. <Link href="/alphabet" className="font-bold text-lajvard-500 underline dark:text-ink">See all 32 letters</Link>.
          </li>
          <li>
            <strong>Transliteration and vowel marks</strong> while a word is new, fading out as you
            learn to read.
          </li>
          <li>
            <strong>Review at the right time</strong>: words you find hard come back sooner.
          </li>
        </ul>
      </section>

      <section aria-labelledby="phrases" className="flex flex-col gap-3">
        <h2 id="phrases" className="text-2xl font-extrabold">
          Your first Persian words
        </h2>
        <ul className="grid gap-3 tablet:grid-cols-2">
          {PHRASES.map((p) => (
            <li
              key={p.fa}
              className="flex items-center justify-between gap-4 rounded-[var(--radius-card)] border-2 border-b-4 border-line p-4"
            >
              <span>
                <span className="block font-bold">{p.translit}</span>
                <span className="text-stone">{p.en}</span>
              </span>
              <Persian className="text-2xl">{p.fa}</Persian>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="faq" className="flex flex-col gap-3">
        <h2 id="faq" className="text-2xl font-extrabold">
          Questions
        </h2>
        <dl className="flex flex-col gap-4">
          {FAQ.map((f) => (
            <div key={f.q}>
              <dt className="font-extrabold">{f.q}</dt>
              <dd className="text-stone">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </article>
  )
}
