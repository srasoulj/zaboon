'use client'
/**
 * Profile (DESIGN-SYSTEM §2.3): name, @username, joined date and stats. Guests get a "Create a
 * profile" call to action instead of a username (the server answers 403 to a guest's username).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { ProfilePatch, type ProfileResponse, type WordsResponse } from '@zaboon/contracts'
import { Button3D, Icon, type IconName } from '@zaboon/ui'
import { queryKeys } from '@/lib/api-client'
import { useApi, useSession } from '@/lib/app-services'
import { ButtonLink } from './ButtonLink'
import { errorMessage } from './hooks'
import { MergeDroppedNotice } from './MergeDroppedNotice'

export const USERNAME_RULE = 'Use 3–20 lowercase letters, numbers or underscores.'

/** The contract's username rule (ProfilePatch); null when valid. */
export function usernameProblem(username: string): string | null {
  return ProfilePatch.safeParse({ username }).success ? null : USERNAME_RULE
}

export function joinedLabel(iso: string): string {
  const month = new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso))
  return `Joined ${month}`
}

function patchError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  if (code === 'conflict') return 'That username is taken'
  if (code === 'forbidden') return 'Create a profile before choosing a username'
  if (code === 'validation') return USERNAME_RULE
  return errorMessage(error)
}

export function ProfileScreen() {
  const api = useApi()
  const session = useSession()
  const signedIn = session.status === 'signed_in'
  const profile = useQuery<ProfileResponse>({
    queryKey: queryKeys.profile,
    queryFn: () => api('profile'),
    enabled: signedIn,
  })
  const words = useQuery<WordsResponse>({
    queryKey: queryKeys.words,
    queryFn: () => api('words'),
    enabled: signedIn,
  })

  if (profile.isError)
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-extrabold">Profile</h1>
        <p role="alert" className="text-wrong-fg">
          {errorMessage(profile.error, "We couldn't load your profile.")}
        </p>
        <Button3D variant="ghost" onClick={() => void profile.refetch()}>
          Try again
        </Button3D>
      </section>
    )
  if (!profile.data)
    return (
      <section aria-busy="true">
        <h1 className="text-2xl font-extrabold">Profile</h1>
        <p className="text-stone">Loading…</p>
      </section>
    )

  const p = profile.data
  const name = p.displayName ?? (p.isAnonymous ? 'Guest learner' : 'Learner')
  return (
    <section className="flex flex-col gap-8" data-testid="profile">
      <MergeDroppedNotice />
      <header className="flex items-center gap-4">
        <div
          aria-hidden="true"
          className="flex size-20 shrink-0 items-center justify-center rounded-full bg-lajvard-500 text-4xl font-black text-white"
        >
          {name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-extrabold">{name}</h1>
          {p.username && <p className="font-bold text-stone">@{p.username}</p>}
          <p className="text-stone">{joinedLabel(p.createdAt)}</p>
        </div>
        <Link
          href="/settings"
          aria-label="Settings"
          className="rounded-full p-2 text-stone hover:bg-surface"
        >
          <GearIcon />
        </Link>
      </header>

      <section aria-labelledby="profile-stats">
        <h2 id="profile-stats" className="mb-3 text-xl font-extrabold">
          Statistics
        </h2>
        <dl className="grid grid-cols-2 gap-3">
          <Stat icon="flame" label="Day streak" value={p.stats.streakCurrent} />
          <Stat icon="star" label="Total XP" value={p.stats.xpTotal} />
          <Stat icon="book" label="Words learned" value={words.data?.words.length ?? null} />
          <Stat icon="trophy" label="Longest streak" value={p.stats.streakLongest} />
        </dl>
      </section>

      {p.isAnonymous ? (
        <section
          className="flex flex-col gap-3 rounded-[var(--radius-card)] border-2 border-line p-5"
          aria-labelledby="create-profile"
        >
          <h2 id="create-profile" className="text-xl font-extrabold">
            Create a profile to save your progress
          </h2>
          <p className="text-stone">
            Add your email so your streak and XP are safe, and pick a username.
          </p>
          <ButtonLink href="/settings/account" fullWidth>
            Create a profile
          </ButtonLink>
        </section>
      ) : null}

      <ProfileForm profile={p} />
    </section>
  )
}

function Stat({ icon, label, value }: { icon: IconName; label: string; value: number | null }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-card)] border-2 border-line p-4">
      <dt className="flex items-center gap-2 text-stone">
        <span className="text-zaferan-600" aria-hidden="true">
          <Icon name={icon} size={24} />
        </span>
        {label}
      </dt>
      <dd className="text-2xl font-extrabold">{value ?? '–'}</dd>
    </div>
  )
}

function ProfileForm({ profile }: { profile: ProfileResponse }) {
  const api = useApi()
  const queryClient = useQueryClient()
  const member = !profile.isAnonymous
  const [displayName, setDisplayName] = useState(profile.displayName ?? '')
  const [username, setUsername] = useState(profile.username ?? '')
  const [saved, setSaved] = useState(false)

  const save = useMutation({
    mutationFn: (body: { displayName?: string; username?: string }) =>
      api('updateProfile', { body }),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.profile, res)
      void queryClient.invalidateQueries({ queryKey: queryKeys.home })
      setSaved(true)
    },
  })

  const trimmedName = displayName.trim()
  const nameChanged = trimmedName !== '' && trimmedName !== (profile.displayName ?? '')
  const usernameChanged = member && username !== '' && username !== (profile.username ?? '')
  const problem = usernameChanged ? usernameProblem(username) : null
  const canSave = (nameChanged || usernameChanged) && problem === null

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    setSaved(false)
    save.mutate({
      ...(nameChanged ? { displayName: trimmedName } : {}),
      ...(usernameChanged ? { username } : {}),
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-[var(--radius-card)] border-2 border-line p-5"
      aria-labelledby="edit-profile"
      noValidate
    >
      <h2 id="edit-profile" className="text-xl font-extrabold">
        Edit profile
      </h2>
      <div className="flex flex-col gap-1">
        <label htmlFor="profile-name" className="font-bold">
          Name
        </label>
        <input
          id="profile-name"
          value={displayName}
          maxLength={40}
          autoComplete="nickname"
          onChange={(e) => {
            setDisplayName(e.target.value)
            setSaved(false)
          }}
          className="rounded-[var(--radius-tile)] border-2 border-line bg-surface px-4 py-3 font-bold focus:border-lajvard-500 focus:outline-none"
        />
      </div>
      {member && (
        <div className="flex flex-col gap-1">
          <label htmlFor="profile-username" className="font-bold">
            Username
          </label>
          <div className="flex items-center rounded-[var(--radius-tile)] border-2 border-line bg-surface focus-within:border-lajvard-500">
            <span className="pl-4 font-bold text-stone" aria-hidden="true">
              @
            </span>
            <input
              id="profile-username"
              value={username}
              maxLength={20}
              autoCapitalize="none"
              autoComplete="username"
              spellCheck={false}
              aria-invalid={problem !== null || undefined}
              aria-describedby="profile-username-help"
              onChange={(e) => {
                setUsername(e.target.value.toLowerCase())
                setSaved(false)
                save.reset()
              }}
              className="min-w-0 flex-1 bg-transparent py-3 pr-4 pl-1 font-bold focus:outline-none"
            />
          </div>
          <p id="profile-username-help" className="text-sm text-stone">
            {USERNAME_RULE}
          </p>
        </div>
      )}
      {problem && (
        <p role="alert" className="text-wrong-fg">
          {problem}
        </p>
      )}
      {save.isError && (
        <p role="alert" className="text-wrong-fg">
          {patchError(save.error)}
        </p>
      )}
      {saved && (
        <p role="status" className="text-correct-fg">
          Saved.
        </p>
      )}
      <Button3D type="submit" variant={canSave ? 'secondary' : 'locked'} loading={save.isPending}>
        Save
      </Button3D>
    </form>
  )
}

function GearIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.3 7.3 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.4 2.5h4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"
        transform="translate(-1 0)"
      />
    </svg>
  )
}
