'use client'
/**
 * /settings/account: create a profile (link an email to the guest, or sign in and merge the guest
 * into an existing account), sign out, GDPR export and account deletion. Every identity switch
 * flushes the lesson outbox first and is refused while it can't be delivered (identity.ts).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { z } from 'zod'
import { Button3D } from '@zaboon/ui'
import { queryKeys } from '@/lib/api-client'
import { useApi, useAuth, useSession } from '@/lib/app-services'
import { errorMessage, useFlushOutbox } from './hooks'
import {
  OutboxBlockedError,
  completePendingMerge,
  linkOrMerge,
  signInAndMerge,
  signOutSafely,
  type FlushOutbox,
  type SwitchResult,
} from './identity'

export const DELETE_CONFIRMATION = 'DELETE'

const Email = z.string().trim().email()

export function saveJsonFile(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export interface AccountScreenProps {
  navigate: (href: string) => void
  /** Flushes the lesson outbox (defaults to the app's shared outbox). */
  flushOutbox?: FlushOutbox
  /** Saves the export (defaults to a browser download). */
  saveFile?: (data: unknown, filename: string) => void
}

function switchMessage(r: SwitchResult, email: string): string {
  if (r.status === 'email_sent') return `Check your email: we sent a link to ${email}.`
  if (r.status === 'linked') return `Profile created. You're signed in as ${email}.`
  return r.home
    ? 'Welcome back! Your guest progress was added to your account.'
    : `You're signed in as ${email}.`
}

function failure(error: unknown): string {
  if (error instanceof OutboxBlockedError) return error.message
  return errorMessage(error, "That didn't work. Please try again.")
}

export function AccountScreen({ navigate, flushOutbox, saveFile = saveJsonFile }: AccountScreenProps) {
  const api = useApi()
  const auth = useAuth()
  const queryClient = useQueryClient()
  const session = useSession()
  const defaultFlush = useFlushOutbox()
  const flush = flushOutbox ?? defaultFlush
  // Outcome of the last identity switch. Kept here, not in the form: a switch unmounts the guest form.
  const [notice, setNotice] = useState<Notice | null>(null)

  // Finish a merge that waited for an emailed sign-in link (Supabase mode).
  const signedInMember = session.status === 'signed_in' && !session.session.isAnonymous
  useEffect(() => {
    if (!signedInMember) return
    let alive = true
    void completePendingMerge({ auth, api }).then((merged) => {
      if (!alive || !merged) return
      queryClient.setQueryData(queryKeys.home, merged)
      void queryClient.invalidateQueries()
      setNotice({ tone: 'ok', text: 'Welcome back! Your guest progress was added to your account.' })
    })
    return () => {
      alive = false
    }
  }, [signedInMember, auth, api, queryClient])

  if (session.status !== 'signed_in')
    return (
      <section>
        <h1 className="text-2xl font-extrabold">Account</h1>
        <p className="text-stone">Loading…</p>
      </section>
    )

  const s = session.session
  return (
    <section className="flex flex-col gap-8" data-testid="account">
      <h1 className="text-2xl font-extrabold">Account</h1>
      {notice?.tone === 'ok' && (
        <p role="status" className="rounded-[var(--radius-card)] bg-correct-bg p-4 font-bold text-correct-fg">
          {notice.text}
        </p>
      )}
      {notice?.tone === 'error' && (
        <p role="alert" className="rounded-[var(--radius-card)] bg-wrong-bg p-4 font-bold text-wrong-fg">
          {notice.text}
        </p>
      )}
      {s.isAnonymous ? (
        <GuestIdentity flush={flush} onResult={setNotice} />
      ) : (
        <MemberIdentity email={s.email} flush={flush} navigate={navigate} />
      )}
      <ExportData saveFile={saveFile} />
      <DeleteAccount navigate={navigate} />
    </section>
  )
}

function Card({ title, children, danger = false }: { title: string; children: ReactNode; danger?: boolean }) {
  const id = useId()
  return (
    <section
      aria-labelledby={id}
      className={
        'flex flex-col gap-3 rounded-[var(--radius-card)] border-2 p-5 ' +
        (danger ? 'border-anar-500' : 'border-line')
      }
    >
      <h2 id={id} className="text-xl font-extrabold">
        {title}
      </h2>
      {children}
    </section>
  )
}

type Notice = { tone: 'ok' | 'error'; text: string }

function GuestIdentity({
  flush,
  onResult,
}: {
  flush: FlushOutbox
  onResult: (notice: Notice | null) => void
}) {
  const api = useApi()
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'create' | 'signin'>('create')
  const [email, setEmail] = useState('')
  const inputId = useId()

  const run = useMutation({
    mutationFn: (address: string) =>
      mode === 'create'
        ? linkOrMerge({ auth, api, flush }, address)
        : signInAndMerge({ auth, api, flush }, address),
    onMutate: () => onResult(null),
    onSuccess: (r, address) => {
      if (r.status === 'merged' && r.home) queryClient.setQueryData(queryKeys.home, r.home)
      void queryClient.invalidateQueries()
      onResult({ tone: 'ok', text: switchMessage(r, address) })
    },
    onError: (error) => onResult({ tone: 'error', text: failure(error) }),
  })

  const valid = Email.safeParse(email).success
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (valid) run.mutate(email.trim())
  }

  return (
    <Card title={mode === 'create' ? 'Create a profile' : 'Sign in'}>
      <p className="text-stone">
        {mode === 'create'
          ? "Add your email to keep your progress safe and learn on any device. You're learning as a guest right now."
          : 'Sign in to your account. What you did as a guest comes with you.'}
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
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
        <Button3D type="submit" variant={valid ? 'primary' : 'locked'} loading={run.isPending}>
          {mode === 'create' ? 'Create a profile' : 'Sign in'}
        </Button3D>
      </form>
      <button
        type="button"
        onClick={() => {
          setMode(mode === 'create' ? 'signin' : 'create')
          run.reset()
        }}
        className="self-center py-2 font-extrabold tracking-wide text-lajvard-500 uppercase dark:text-ink"
      >
        {mode === 'create' ? 'I already have an account' : 'Create a new profile instead'}
      </button>
    </Card>
  )
}

function MemberIdentity({
  email,
  flush,
  navigate,
}: {
  email: string | null
  flush: FlushOutbox
  navigate: (href: string) => void
}) {
  const auth = useAuth()
  const signOut = useMutation({
    mutationFn: () => signOutSafely({ auth, flush }),
    onSuccess: () => navigate('/'),
  })
  return (
    <Card title="Signed in">
      <p>
        {email ? (
          <>
            You&apos;re signed in as <strong>{email}</strong>.
          </>
        ) : (
          "You're signed in."
        )}
      </p>
      {signOut.isError && (
        <p role="alert" className="text-wrong-fg">
          {failure(signOut.error)}
        </p>
      )}
      <Button3D variant="ghost" loading={signOut.isPending} onClick={() => signOut.mutate()}>
        Sign out
      </Button3D>
    </Card>
  )
}

function ExportData({ saveFile }: { saveFile: (data: unknown, filename: string) => void }) {
  const api = useApi()
  const run = useMutation({
    mutationFn: () => api('exportAccount'),
    onSuccess: (data) => {
      const day = new Date().toISOString().slice(0, 10)
      saveFile(data, `zaboon-export-${day}.json`)
    },
  })
  return (
    <Card title="Your data">
      <p className="text-stone">
        Download everything Zaboon stores about you, as a JSON file.
      </p>
      {run.isError && (
        <p role="alert" className="text-wrong-fg">
          {failure(run.error)}
        </p>
      )}
      {run.isSuccess && (
        <p role="status" className="text-correct-fg">
          Your download has started.
        </p>
      )}
      <Button3D variant="secondary" loading={run.isPending} onClick={() => run.mutate()}>
        Download my data
      </Button3D>
    </Card>
  )
}

function DeleteAccount({ navigate }: { navigate: (href: string) => void }) {
  const api = useApi()
  const auth = useAuth()
  const [typed, setTyped] = useState('')
  const inputId = useId()
  const run = useMutation({
    mutationFn: async () => {
      await api('deleteAccount')
      // The data is gone, so pending lesson writes have nowhere to go: no outbox flush here.
      await auth.signOut()
    },
    onSuccess: () => navigate('/'),
  })
  const confirmed = typed.trim() === DELETE_CONFIRMATION
  return (
    <Card title="Delete account" danger>
      <p className="text-stone">
        This permanently deletes your progress, streak and profile. It can&apos;t be undone.
      </p>
      <label htmlFor={inputId} className="font-bold">
        Type {DELETE_CONFIRMATION} to confirm
      </label>
      <input
        id={inputId}
        value={typed}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        onChange={(e) => setTyped(e.target.value)}
        className="rounded-[var(--radius-tile)] border-2 border-line bg-surface px-4 py-3 font-bold focus:border-anar-500 focus:outline-none"
      />
      {run.isError && (
        <p role="alert" className="text-wrong-fg">
          {failure(run.error)}
        </p>
      )}
      <Button3D
        variant={confirmed ? 'danger' : 'locked'}
        loading={run.isPending}
        onClick={() => run.mutate()}
      >
        Delete my account
      </Button3D>
    </Card>
  )
}
