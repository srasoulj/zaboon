// The marketing site (ARCHITECTURE §4): static pages with their own header and footer, no app shell.
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ButtonLink } from '@/components/pages/ButtonLink'
import { ZaBadge } from '@/components/pages/ZaBadge'

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <header className="border-b-2 border-line">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-2xl font-black tracking-tight text-firouzeh-600 dark:text-firouzeh-500"
          >
            <ZaBadge size={36} />
            zaboon
          </Link>
          <nav aria-label="Site" className="flex items-center gap-4 font-extrabold">
            <Link href="/learn-persian" className="hidden text-stone hover:text-ink tablet:inline">
              Learn Persian
            </Link>
            <Link href="/alphabet" className="hidden text-stone hover:text-ink tablet:inline">
              Alphabet
            </Link>
            <ButtonLink href="/onboarding" className="hidden tablet:inline-flex">
              Get started
            </ButtonLink>
            <Link href="/sign-in" className="text-lajvard-500 dark:text-ink tablet:hidden">
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t-2 border-line">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-8 text-stone tablet:flex-row tablet:justify-between">
          <p>Zaboon: learn Persian (Farsi), one bite-sized lesson at a time.</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-4 font-bold">
            <Link href="/learn-persian">Learn Persian</Link>
            <Link href="/alphabet">The Persian alphabet</Link>
            <Link href="/sign-in">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
