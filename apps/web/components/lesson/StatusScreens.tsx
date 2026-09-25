'use client'
import type { ReactNode } from 'react'
import { Button3D, Character } from '@zaboon/ui'

function Centered({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <section
      className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4 text-center"
      data-testid={testId}
    >
      {children}
    </section>
  )
}

export function LoadingScreen({ label = 'Loading your lesson…' }: { label?: string }) {
  return (
    <Centered testId="lesson-loading">
      <Character name="hodhod" mood="thinking" size={120} decorative />
      <p className="font-bold text-stone" role="status">
        {label}
      </p>
    </Centered>
  )
}

export function ExpiredScreen({
  onRestart,
  onQuit,
}: {
  onRestart: () => void
  onQuit: () => void
}) {
  return (
    <Centered testId="lesson-expired">
      <Character name="hodhod" mood="sad" size={120} decorative />
      <h1 className="text-[24px] font-extrabold">This lesson has expired</h1>
      <p className="text-stone">Lessons stay open for a day. Start it again to keep learning.</p>
      <div className="flex w-full max-w-[360px] flex-col gap-3">
        <Button3D onClick={onRestart} fullWidth data-testid="lesson-restart">
          Start again
        </Button3D>
        <Button3D variant="ghost" onClick={onQuit} fullWidth>
          Back
        </Button3D>
      </div>
    </Centered>
  )
}

const MESSAGES: Record<string, string> = {
  network: "You're offline. Check your connection and try again.",
  forbidden: "This lesson isn't unlocked yet.",
  not_found: "We couldn't find this lesson.",
  rate_limited: 'Too many requests. Take a breath and try again in a moment.',
  upgrade_required: 'A new version of Zaboon is available. Reload the page to update.',
}

export function ErrorScreen({
  code,
  onRetry,
  onQuit,
}: {
  code: string
  onRetry: () => void
  onQuit: () => void
}) {
  return (
    <Centered testId="lesson-error">
      <Character name="hodhod" mood="sad" size={120} decorative />
      <h1 className="text-[24px] font-extrabold">Something went wrong</h1>
      <p className="text-stone" role="alert" data-code={code}>
        {MESSAGES[code] ?? 'Please try again.'}
      </p>
      <div className="flex w-full max-w-[360px] flex-col gap-3">
        <Button3D onClick={onRetry} fullWidth data-testid="lesson-retry">
          Try again
        </Button3D>
        <Button3D variant="ghost" onClick={onQuit} fullWidth>
          Back
        </Button3D>
      </div>
    </Centered>
  )
}
