import './globals.css'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'Zaboon: learn Persian',
  description: 'A playful way to learn Persian (Farsi), one bite-sized lesson at a time.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
