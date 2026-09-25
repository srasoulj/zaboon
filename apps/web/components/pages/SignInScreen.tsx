'use client'
/**
 * The small email sign-in page (/sign-in). A guest on this device is merged into the account
 * (identity.ts), after the lesson outbox is delivered; a member is sent on to the app.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { z } from 'zod'
import { Button3D } from '@zaboon/ui'
import { queryKeys } from '@/lib/api-client'
import { useApi, useAuth, useSession } from '@/lib/app-services'
import { ButtonLink } from './ButtonLink'
import { errorMessage, useFlushOutbox } from './hooks'
import { OutboxBlockedError, signInAndMerge, type FlushOutbox } from './identity'

const Email = z.string().trim().email()

export function SignInScreen({
  navigate,
  flushOutbox,
}: {
  navigate: (href: string) => void
  flushOutbox?: FlushOutbox
}) {
  const api = useApi()
  const auth = useAuth()
  const session = useSession()
  const queryClient = useQueryClient()
  const defaultFlush = useFlushOutbox()
  const flush = flushOutbox ?? defaultFlush
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const inputId = useId()

  const run = useMutation({
    mutationFn: (address: string) => signInAndMerge({ auth, api, flush }, address),
    onSuccess: (r, address) => {
      if (r.status === 'email_sent') {
        setSentTo(address)
        return
      }
      if (r.status === 'merged' && r.home) queryClient.setQueryData(queryKeys.home, r.home)
      navigate('/learn')
    },
  })

  const member = session.status === 'signed_in' && !session.session.isAnonymous
  const valid = Email.safeParse(email).success

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-14">
      <h1 className="text-3xl font-black tracking-tight">Sign in</h1>
      {member && !run.isPending && !run.isSuccess ? (
        <div className="flex flex-col gap-4">
          <p>
            You&apos;re already signed in
            {session.session.email ? (
              <>
                {' '}
                as <strong>{session.session.email}</strong>
              </>
            ) : null}
            .
          </p>
          <ButtonLink href="/learn" fullWidth>
            Continue learning
          </ButtonLink>
        </div>
      ) : sentTo ? (
        <p role="status" className="rounded-[var(--radius-card)] bg-correct-bg p-4 font-bold text-correct-fg">
          Check your email: we sent a sign-in link to {sentTo}.
        </p>
      ) : (
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (valid) run.mutate(email.trim())
          }}
        >
          <p className="text-stone">
            Enter the email of your Zaboon account. Anything you did as a guest on this device comes
            with you.
          </p>
          <label htmlFor={inputId} className="font-bold">
            Email
          </label>
          <input
            id={inputId}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              run.reset()
            }}
            className="rounded-[var(--radius-tile)] border-2 border-line bg-surface px-4 py-3 font-bold focus:border-lajvard-500 focus:outline-none"
          />
          {run.isError && (
            <p role="alert" className="text-wrong-fg">
              {run.error instanceof OutboxBlockedError
                ? run.error.message
                : errorMessage(run.error, "We couldn't sign you in. Please try again.")}
            </p>
          )}
          <Button3D type="submit" variant={valid ? 'primary' : 'locked'} loading={run.isPending}>
            Sign in
          </Button3D>
          <ButtonLink href="/onboarding" variant="ghost">
            New here? Get started
          </ButtonLink>
        </form>
      )}
    </section>
  )
}
