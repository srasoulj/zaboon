'use client'
/**
 * Onboarding (DESIGN-SYSTEM §2.3, ARCHITECTURE §10.1, §12): Welcome → why are you learning → how
 * much Persian do you know → daily goal → a neutral age question. Steps live in component state, so
 * the whole flow is plain /onboarding.
 *
 * - Under 13: never POSTs; the block is remembered on the device (age-gate.ts).
 * - Otherwise POST /api/onboarding, seed the home query with the response BEFORE navigating (the
 *   shell would otherwise see a stale "not onboarded" home and bounce back here), then go to the
 *   Letters tab ("I speak but can't read": the heritage fast track) or the first lesson.
 * - Learners who already onboarded are sent to /learn.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  DEFAULT_APP_CONFIG,
  type HomeResponse,
  type LearningReason,
  type SelfLevel,
} from '@zaboon/contracts'
import type { z } from 'zod'
import { Button3D, ChoiceCard, Icon, ProgressBar, useDigitShortcuts } from '@zaboon/ui'
import { queryKeys } from '@/lib/api-client'
import { useApi, useHome, useSession } from '@/lib/app-services'
import { lessonHref } from '@/lib/lesson/request'
import { MIN_AGE, isAgeBlocked, parseAge, rememberAgeBlock } from './age-gate'
import { browserTimeZone, errorMessage } from './hooks'
import { ZaBadge } from './ZaBadge'

type Reason = z.infer<typeof LearningReason>
type Level = z.infer<typeof SelfLevel>

export const REASONS: readonly { value: Reason; label: string }[] = [
  { value: 'heritage', label: 'My family or heritage' },
  { value: 'partner', label: 'My partner or their family' },
  { value: 'travel', label: 'Travel' },
  { value: 'culture', label: 'Culture, music and poetry' },
  { value: 'work', label: 'Work or school' },
  { value: 'other', label: 'Something else' },
]

export const LEVELS: readonly { value: Level; label: string; hint: string }[] = [
  { value: 'new', label: "I'm new to Persian", hint: 'Start from the very beginning.' },
  { value: 'some_words', label: 'I know some words', hint: 'Greetings, a few phrases.' },
  {
    value: 'speak_not_read',
    label: "I speak Persian but can't read it",
    hint: "We'll start you on the alphabet.",
  },
  { value: 'basics', label: 'I know the basics', hint: 'I can read and hold a simple chat.' },
]

const GOAL_NAMES: Record<number, string> = { 10: 'Casual', 20: 'Regular', 30: 'Serious', 50: 'Intense' }
export const goalLabel = (xp: number) => `${GOAL_NAMES[xp] ?? 'Custom'} · ${xp} XP a day`

const STEPS = ['welcome', 'reason', 'level', 'goal', 'age'] as const
type Step = (typeof STEPS)[number]

/** Where a freshly onboarded learner starts. */
export function firstStop(selfLevel: Level, home: HomeResponse): string {
  if (selfLevel === 'speak_not_read') return '/letters'
  const levelId = home.course.currentLevelId
  return levelId ? lessonHref({ courseId: home.course.id, kind: 'lesson', levelId }) : '/learn'
}

export interface OnboardingProps {
  /** Replaces the current URL (router.replace in the app). */
  navigate: (href: string) => void
  /** Daily goal choices (AppConfig.dailyGoal). */
  goals?: { options: readonly number[]; default: number }
}

export function Onboarding({ navigate, goals = DEFAULT_APP_CONFIG.dailyGoal }: OnboardingProps) {
  const api = useApi()
  const queryClient = useQueryClient()
  const session = useSession()
  const signedIn = session.status === 'signed_in'
  const home = useHome(signedIn)

  const [step, setStep] = useState<Step>('welcome')
  const [reason, setReason] = useState<Reason | null>(null)
  const [level, setLevel] = useState<Level | null>(null)
  const [goal, setGoal] = useState<number>(goals.default)
  const [age, setAge] = useState('')
  const [blocked, setBlocked] = useState(false)
  // Set once this flow has onboarded the learner: from then on the seeded home says "onboarded",
  // which must not trigger the "already onboarded" redirect.
  const finished = useRef(false)

  useEffect(() => {
    if (isAgeBlocked()) setBlocked(true)
  }, [])

  useEffect(() => {
    if (!finished.current && home.data?.user.onboarded) navigate('/learn')
  }, [home.data, navigate])

  const submit = useMutation({
    mutationFn: (vars: { reason: Reason; selfLevel: Level; dailyGoalXp: number }) =>
      api('onboarding', { body: { ...vars, ageConfirmed: true, tz: browserTimeZone() } }),
    onSuccess: (res, vars) => {
      finished.current = true
      queryClient.setQueryData(queryKeys.home, res)
      navigate(firstStop(vars.selfLevel, res))
    },
  })

  // Keyboard (DESIGN-SYSTEM §8): 1–9 picks an option on the multiple-choice steps.
  const optionCount =
    step === 'reason'
      ? REASONS.length
      : step === 'level'
        ? LEVELS.length
        : step === 'goal'
          ? goals.options.length
          : 0
  useDigitShortcuts(
    optionCount,
    (n) => {
      if (step === 'reason') setReason(REASONS[n - 1]!.value)
      else if (step === 'level') setLevel(LEVELS[n - 1]!.value)
      else if (step === 'goal') setGoal(goals.options[n - 1]!)
    },
    optionCount > 0 && !blocked,
  )

  if (blocked) return <AgeBlocked />

  const index = STEPS.indexOf(step)
  const back = index > 0 ? () => setStep(STEPS[index - 1]!) : undefined
  const next = () => setStep(STEPS[index + 1]!)

  if (step === 'welcome')
    return (
      <Frame>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <ZaBadge size={96} />
          <h1 className="text-3xl font-extrabold">Welcome to Zaboon</h1>
          <p className="max-w-sm text-lg text-stone">
            Learn Persian (Farsi) in bite-sized lessons. A few quick questions and you&apos;re in.
          </p>
        </div>
        <Footer>
          <Button3D fullWidth onClick={next}>
            Get started
          </Button3D>
          <Link
            href="/sign-in"
            className="block py-2 text-center font-extrabold tracking-wide text-lajvard-500 uppercase dark:text-ink"
          >
            I already have an account
          </Link>
        </Footer>
      </Frame>
    )

  const parsedAge = parseAge(age)
  const onAge = () => {
    if (parsedAge === null || !reason || !level) return
    if (parsedAge < MIN_AGE) {
      rememberAgeBlock()
      setBlocked(true)
      return
    }
    submit.mutate({ reason, selfLevel: level, dailyGoalXp: goal })
  }

  return (
    <Frame>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={back}
          aria-label="Back"
          className="rounded-full p-2 text-stone hover:bg-surface focus-visible:outline-2 focus-visible:outline-lajvard-500"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M15 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <ProgressBar
          className="flex-1"
          value={index / (STEPS.length - 1)}
          label="Onboarding progress"
        />
      </div>

      {step === 'reason' && (
        <Question title="Why are you learning Persian?">
          {(labelledBy) => (
            <Choices labelledBy={labelledBy}>
              {REASONS.map((r, i) => (
                <ChoiceCard
                  key={r.value}
                  index={i + 1}
                  selected={reason === r.value}
                  onSelect={() => setReason(r.value)}
                >
                  {r.label}
                </ChoiceCard>
              ))}
            </Choices>
          )}
        </Question>
      )}

      {step === 'level' && (
        <Question title="How much Persian do you know?">
          {(labelledBy) => (
            <Choices labelledBy={labelledBy}>
              {LEVELS.map((l, i) => (
                <ChoiceCard
                  key={l.value}
                  index={i + 1}
                  selected={level === l.value}
                  onSelect={() => setLevel(l.value)}
                >
                  <span className="block">{l.label}</span>
                  <span className="block text-base font-semibold text-stone">{l.hint}</span>
                </ChoiceCard>
              ))}
            </Choices>
          )}
        </Question>
      )}

      {step === 'goal' && (
        <Question title="Pick a daily goal" subtitle="You can change it any time in Settings.">
          {(labelledBy) => (
            <Choices labelledBy={labelledBy}>
              {goals.options.map((xp, i) => (
                <ChoiceCard
                  key={xp}
                  index={i + 1}
                  selected={goal === xp}
                  onSelect={() => setGoal(xp)}
                >
                  {goalLabel(xp)}
                </ChoiceCard>
              ))}
            </Choices>
          )}
        </Question>
      )}

      {step === 'age' && (
        <Question title="How old are you?">
          {() => (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                onAge()
              }}
            >
              <label htmlFor="onboarding-age" className="font-bold">
                Your age
              </label>
              <input
                id="onboarding-age"
                inputMode="numeric"
                autoComplete="off"
                maxLength={3}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="rounded-[var(--radius-tile)] border-2 border-line bg-surface px-4 py-3 text-lg font-bold focus:border-lajvard-500 focus:outline-none"
              />
            </form>
          )}
        </Question>
      )}

      {submit.isError && (
        <p role="alert" className="text-wrong-fg">
          {errorMessage(submit.error)}
        </p>
      )}

      <Footer>
        {step === 'age' ? (
          <Button3D
            fullWidth
            variant={parsedAge === null || !signedIn ? 'locked' : 'primary'}
            loading={submit.isPending}
            onClick={onAge}
          >
            Continue
          </Button3D>
        ) : (
          <Button3D
            fullWidth
            variant={
              (step === 'reason' && !reason) || (step === 'level' && !level) ? 'locked' : 'primary'
            }
            onClick={next}
          >
            Continue
          </Button3D>
        )}
      </Footer>
    </Frame>
  )
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-6"
      data-testid="onboarding"
    >
      {children}
    </div>
  )
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex flex-col gap-3 pt-4">{children}</div>
}

function Question({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: (labelledBy: string) => ReactNode
}) {
  const id = useId()
  return (
    <section className="flex flex-col gap-5" aria-labelledby={id}>
      <div>
        <h1 id={id} className="text-2xl font-extrabold">
          {title}
        </h1>
        {subtitle && <p className="text-stone">{subtitle}</p>}
      </div>
      {children(id)}
    </section>
  )
}

function Choices({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-col gap-3">
      {children}
    </div>
  )
}

function AgeBlocked() {
  return (
    <Frame>
      <div
        className="flex flex-1 flex-col items-center justify-center gap-4 text-center"
        data-testid="age-blocked"
      >
        <span className="text-stone">
          <Icon name="lock" size={48} />
        </span>
        <h1 className="text-2xl font-extrabold">Sorry, you can&apos;t use Zaboon yet</h1>
        <p className="max-w-sm text-stone">
          Zaboon is for learners aged {MIN_AGE} and older. Nothing you entered here was saved.
        </p>
        <Link href="/" className="font-extrabold text-lajvard-500 underline dark:text-ink">
          Back to the home page
        </Link>
      </div>
    </Frame>
  )
}
