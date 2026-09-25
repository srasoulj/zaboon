import './globals.css'
import type { Metadata, Viewport } from 'next'
import { Nunito, Vazirmatn } from 'next/font/google'
import type { ReactNode } from 'react'
import { Providers } from './providers'

// Orchestrator-owned root layout. The font variables feed the design tokens
// (--font-latin / --font-persian) used by every component.
const nunito = Nunito({ subsets: ['latin'], variable: '--font-latin', display: 'swap' })
const vazirmatn = Vazirmatn({
  subsets: ['arabic', 'latin'],
  variable: '--font-persian',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Zaboon: learn Persian', template: '%s · Zaboon' },
  description: 'A playful way to learn Persian (Farsi), one bite-sized lesson at a time.',
  applicationName: 'Zaboon',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#10181b' },
  ],
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${nunito.variable} ${vazirmatn.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
