'use client'
/**
 * Settings (DESIGN-SYSTEM §2.3, §8): daily goal, transliteration and vowel marks, sound, motion and
 * (behind the persianKeyboard flag) the keyboard layout. Every change is one PATCH /api/settings;
 * home and settings are invalidated afterwards (the shell, the motion provider and the lesson player
 * read them from home).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useId, type ReactNode } from 'react'
import { DEFAULT_APP_CONFIG, type Settings } from '@zaboon/contracts'
import { queryKeys } from '@/lib/api-client'
import { useApi, useSession } from '@/lib/app-services'
import { errorMessage, useMeta } from './hooks'
import { goalLabel } from './Onboarding'

type Patch = Partial<Settings>
type Tristate = Settings['transliteration']

const TRISTATE: readonly { value: Tristate; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
]

export function SettingsScreen({
  goals = DEFAULT_APP_CONFIG.dailyGoal.options,
}: {
  goals?: readonly number[]
}) {
  const api = useApi()
  const queryClient = useQueryClient()
  const session = useSession()
  const signedIn = session.status === 'signed_in'
  const settings = useQuery<Settings>({
    queryKey: queryKeys.settings,
    queryFn: () => api('settings'),
    enabled: signedIn,
  })
  const meta = useMeta()

  const update = useMutation({
    mutationFn: (patch: Patch) => api('updateSettings', { body: patch }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings })
      const previous = queryClient.getQueryData<Settings>(queryKeys.settings)
      if (previous) queryClient.setQueryData<Settings>(queryKeys.settings, { ...previous, ...patch })
      return { previous }
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKeys.settings, ctx.previous)
    },
    onSuccess: (res) => queryClient.setQueryData(queryKeys.settings, res),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
      ]),
  })

  const s = settings.data
  return (
    <section className="flex flex-col gap-8" data-testid="settings">
      <h1 className="text-2xl font-extrabold">Settings</h1>
      {settings.isError && (
        <p role="alert" className="text-wrong-fg">
          {errorMessage(settings.error, "We couldn't load your settings.")}
        </p>
      )}
      {!s && !settings.isError && <p className="text-stone">Loading…</p>}
      {s && (
        <>
          <Group title="Daily goal">
            <Choice
              legend="Daily goal"
              hideLegend
              name="dailyGoalXp"
              value={s.dailyGoalXp}
              options={goals.map((g) => ({ value: g, label: goalLabel(g) }))}
              onChange={(v) => update.mutate({ dailyGoalXp: v })}
              stacked
            />
          </Group>

          <Group title="Lessons">
            <Choice
              legend="Transliteration"
              hint="Latin letters under Persian words. Auto shows them for new words."
              name="transliteration"
              value={s.transliteration}
              options={TRISTATE}
              onChange={(v) => update.mutate({ transliteration: v })}
            />
            <Choice
              legend="Vowel marks"
              hint="Short-vowel marks (ـَ ـِ ـُ). Auto shows them while you learn a word."
              name="vowelMarks"
              value={s.vowelMarks}
              options={TRISTATE}
              onChange={(v) => update.mutate({ vowelMarks: v })}
            />
            {meta.data?.flags.persianKeyboard === true && (
              <Choice
                legend="Persian keyboard"
                hint="Standard is the usual Persian layout; phonetic puts letters where they sound on an English keyboard."
                name="keyboardLayout"
                value={s.keyboardLayout}
                options={[
                  { value: 'standard', label: 'Standard' },
                  { value: 'phonetic', label: 'Phonetic' },
                ]}
                onChange={(v) => update.mutate({ keyboardLayout: v })}
              />
            )}
          </Group>

          <Group title="Sound and motion">
            <Switch
              label="Sound effects"
              checked={s.sound}
              onChange={(v) => update.mutate({ sound: v })}
            />
            <Switch
              label="Reduce motion"
              hint="Fewer animations in lessons and celebrations."
              checked={s.motion === 'reduced'}
              onChange={(v) => update.mutate({ motion: v ? 'reduced' : 'full' })}
            />
          </Group>

          <p role="status" aria-live="polite" className="min-h-6 text-stone">
            {update.isPending ? 'Saving…' : update.isSuccess ? 'Saved.' : ''}
          </p>
          {update.isError && (
            <p role="alert" className="text-wrong-fg">
              {errorMessage(update.error, "We couldn't save that change.")}
            </p>
          )}
        </>
      )}

      <Group title="Account">
        <Link
          href="/settings/account"
          className="flex items-center justify-between rounded-[var(--radius-card)] border-2 border-b-4 border-line p-4 font-extrabold hover:bg-surface"
        >
          Profile, sign-in and your data
          <span aria-hidden="true">›</span>
        </Link>
      </Group>
    </section>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-xl font-extrabold">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Choice<T extends string | number>({
  legend,
  hideLegend = false,
  hint,
  name,
  value,
  options,
  onChange,
  stacked = false,
}: {
  legend: string
  hideLegend?: boolean
  hint?: string
  name: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  stacked?: boolean
}) {
  const hintId = useId()
  return (
    <fieldset aria-describedby={hint ? hintId : undefined} className="flex flex-col gap-2">
      <legend className={hideLegend ? 'sr-only' : 'mb-1 font-extrabold'}>{legend}</legend>
      {hint && (
        <p id={hintId} className="text-stone">
          {hint}
        </p>
      )}
      <div className={stacked ? 'flex flex-col gap-2' : 'grid auto-cols-fr grid-flow-col gap-2'}>
        {options.map((o) => {
          const checked = o.value === value
          return (
            <label
              key={String(o.value)}
              className={
                'card-3d flex cursor-pointer items-center justify-center gap-2 px-4 py-3 font-bold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-lajvard-500 ' +
                (stacked ? 'justify-start ' : '') +
                (checked ? 'border-selected-border bg-selected-bg' : '')
              }
            >
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={checked}
                onChange={() => onChange(o.value)}
              />
              {o.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <label htmlFor={id} className="font-extrabold">
          {label}
        </label>
        {hint && <p className="text-stone">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={
          'relative h-8 w-14 shrink-0 rounded-full border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lajvard-500 ' +
          (checked ? 'border-firouzeh-600 bg-firouzeh-500' : 'border-line bg-surface')
        }
      >
        <span
          aria-hidden="true"
          className={
            'absolute top-0.5 size-6 rounded-full bg-white shadow transition-[left] ' +
            (checked ? 'left-6' : 'left-0.5')
          }
        />
      </button>
    </div>
  )
}
