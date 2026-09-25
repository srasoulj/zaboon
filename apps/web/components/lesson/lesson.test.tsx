/** DOM tests for the lesson player's footer, feedback, report sheet, complete screens and flow. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Settings } from '@zaboon/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '../../lib/api-client'
import { AppServicesProvider } from '../../lib/app-services'
import type { AuthClient } from '../../lib/auth-client'
import { createSilentAudio } from '../../lib/lesson/audio'
import { MemoryOutboxStore, MemorySnapshotStore } from '../../lib/lesson/stores'
import type { CompleteSummary } from '../../lib/lesson/summary'
import type { LessonRequest } from '../../lib/lesson/request'
import { testChallenges, testResult, testSession, USER_ID } from '../../lib/lesson/test-support'
import { DailyGoalScreen, StreakScreen, SummaryScreen } from './CompleteScreens'
import { LessonFeedback, praiseFor } from './LessonFeedback'
import { LessonFooter } from './LessonFooter'
import { LessonPlayer } from './LessonPlayer'
import { answerText, ReportSheet, reportItemRef } from './ReportSheet'
import { MAX_ATTEMPTS, Outbox, type OutboxSender } from '../../lib/lesson/outbox'
import {
  LessonServicesProvider,
  OutboxReplayer,
  outboxUser,
  retagOutboxUser,
  sharedLessonStores,
  type RendererResolver,
} from './services'
import { fixture } from '@/components/challenges/testing'
import { rendererFor } from '@/lib/challenge-registry'
import { correctResponse, resolveTestRenderer, wrongResponse } from './test-renderers'

afterEach(() => {
  cleanup()
})

describe('LessonFooter', () => {
  it('CHECK is locked (grey, aria-disabled) until there is a response', () => {
    const onCheck = vi.fn()
    const { rerender } = render(
      <LessonFooter canCheck={false} onCheck={onCheck} onSkip={() => {}} />,
    )
    const check = screen.getByRole('button', { name: 'Check' })
    expect(check).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(check)
    expect(onCheck).not.toHaveBeenCalled()
    rerender(<LessonFooter canCheck onCheck={onCheck} onSkip={() => {}} />)
    expect(screen.getByRole('button', { name: 'Check' })).not.toHaveAttribute('aria-disabled')
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(onCheck).toHaveBeenCalledTimes(1)
  })

  it('SKIP always works', () => {
    const onSkip = vi.fn()
    render(<LessonFooter canCheck={false} onCheck={() => {}} onSkip={onSkip} />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(onSkip).toHaveBeenCalled()
  })
})

describe('LessonFeedback', () => {
  it('praises a correct answer and focuses CONTINUE', () => {
    const onContinue = vi.fn()
    render(
      <LessonFeedback
        verdict="correct"
        attemptSeq={0}
        solution={null}
        onContinue={onContinue}
        onReport={() => {}}
      />,
    )
    expect(screen.getByRole('heading', { name: praiseFor(0) })).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: 'Continue' })
    expect(btn).toHaveFocus()
    fireEvent.click(btn)
    expect(onContinue).toHaveBeenCalled()
  })

  it('shows the correct solution (Persian through FaText) and the report flag for a wrong answer', () => {
    const onReport = vi.fn()
    render(
      <LessonFeedback
        verdict="wrong"
        attemptSeq={1}
        solution={{ text: 'سلام', lang: 'fa' }}
        onContinue={() => {}}
        onReport={onReport}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Correct solution:' })).toBeInTheDocument()
    const fa = screen.getByText('سلام').closest('[lang="fa"]')
    expect(fa).toHaveAttribute('dir', 'rtl')
    // An RTL island: its own block, aligned to its start (the right), like the RTL answer line.
    const island = screen.getByTestId('feedback-solution-fa')
    expect(island).toHaveAttribute('lang', 'fa')
    expect(island).toHaveAttribute('dir', 'rtl')
    expect(island).toHaveStyle({ textAlign: 'start' })
    expect(island).toContainElement(screen.getByText('سلام'))
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }))
    expect(onReport).toHaveBeenCalled()
  })

  it('accepts a typo with a note and the right spelling', () => {
    render(
      <LessonFeedback
        verdict="typo"
        attemptSeq={2}
        solution={{ text: 'hello friend', lang: 'en' }}
        onContinue={() => {}}
        onReport={() => {}}
      />,
    )
    expect(screen.getByTestId('lesson-feedback')).toHaveAttribute('data-verdict', 'typo')
    expect(screen.getByText('You have a typo.')).toBeInTheDocument()
    expect(screen.getByText('hello friend')).toBeInTheDocument()
  })

  it('a skip says it will come back', () => {
    render(
      <LessonFeedback
        verdict="skipped"
        attemptSeq={0}
        solution={null}
        onContinue={() => {}}
        onReport={() => {}}
      />,
    )
    expect(screen.getByText("We'll come back to this one.")).toBeInTheDocument()
  })
})

describe('ReportSheet', () => {
  const [select, bank] = testChallenges() as [
    ReturnType<typeof testChallenges>[0],
    ReturnType<typeof testChallenges>[1],
  ]

  it('maps challenges to item refs and answers to text', () => {
    expect(reportItemRef(select)).toBe('sentence:s_t_0001')
    expect(reportItemRef(testChallenges()[2]!)).toBe('lexeme:lx_salam')
    expect(answerText({ kind: 'tiles', value: ['hello', 'water'] })).toBe('hello water')
    expect(answerText({ kind: 'choice', value: 1 })).toBeUndefined()
  })

  it('posts createReport with the chosen kind and the learner answer', async () => {
    const submit = vi.fn(async () => ({ id: 'x' }))
    render(
      <ReportSheet
        open
        onClose={() => {}}
        challenge={bank}
        sessionId="0b9a4f7e-6c1d-4e2a-9f3b-8a7c6d5e4f30"
        response={{ kind: 'tiles', value: ['hello', 'water'] }}
        submit={submit}
      />,
    )
    const send = screen.getByTestId('report-submit')
    expect(send).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByLabelText('My answer should be accepted'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  both are fine  ' } })
    fireEvent.click(send)
    await screen.findByText('Thanks for the report!')
    expect(submit).toHaveBeenCalledWith({
      itemRef: 'sentence:s_t_0002',
      kind: 'answer_should_be_accepted',
      sessionId: '0b9a4f7e-6c1d-4e2a-9f3b-8a7c6d5e4f30',
      answer: 'hello water',
      text: 'both are fine',
    })
  })

  it('hides "my answer should be accepted" without a typed answer, and shows failures', async () => {
    const submit = vi.fn(async () => {
      throw new Error('offline')
    })
    render(
      <ReportSheet
        open
        onClose={() => {}}
        challenge={select}
        sessionId="s"
        response={{ kind: 'choice', value: 0 }}
        submit={submit}
      />,
    )
    expect(screen.queryByLabelText('My answer should be accepted')).toBeNull()
    fireEvent.click(screen.getByLabelText('The audio has a problem'))
    fireEvent.click(screen.getByTestId('report-submit'))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't send the report")
  })
})

describe('complete screens', () => {
  const summary: CompleteSummary = {
    source: 'server',
    xp: 15,
    perfect: true,
    accuracy: 0.75,
    durationMs: 65_000,
    streak: { days: 3, extendedToday: true },
    dailyGoal: { xp: 25, goal: 20, justMet: true },
  }

  it('shows XP, accuracy and time cards (final values for screen readers) and continues', async () => {
    const onContinue = vi.fn()
    render(<SummaryScreen summary={summary} offline={false} onContinue={onContinue} />)
    expect(screen.getByRole('heading', { name: 'Perfect lesson!' })).toBeInTheDocument()
    expect(screen.getByTestId('complete-xp')).toHaveAttribute('data-value', '15')
    expect(
      within(screen.getByTestId('complete-xp')).getByText('15', { selector: '.zb-sr-only' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('complete-accuracy')).toHaveAttribute('data-value', '75%')
    expect(screen.getByTestId('complete-time')).toHaveAttribute('data-value', '1:05')
    expect(screen.getByText('Your progress is saved.')).toBeInTheDocument()
    // the count-up reaches the final value
    const shown = screen.getByTestId('complete-xp').querySelector('span[aria-hidden="true"]')
    // the count-up animates for ~900 ms
    await waitFor(() => expect(shown).toHaveTextContent('15'), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onContinue).toHaveBeenCalled()
  })

  it('an offline summary says it will sync', () => {
    render(
      <SummaryScreen
        summary={{ ...summary, source: 'local', perfect: false }}
        offline
        onContinue={() => {}}
      />,
    )
    expect(screen.getByTestId('complete-summary')).toHaveAttribute('data-source', 'local')
    expect(screen.getByText(/You're offline/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Lesson complete!' })).toBeInTheDocument()
  })

  it('shows the streak and the daily goal', () => {
    const { unmount } = render(<StreakScreen days={3} onContinue={() => {}} />)
    expect(screen.getByTestId('streak-days')).toHaveAttribute('data-value', '3')
    expect(screen.getByText('3 day streak')).toBeInTheDocument()
    unmount()
    render(<DailyGoalScreen xp={25} goal={20} onContinue={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Daily goal complete!' })).toBeInTheDocument()
    expect(screen.getByTestId('goal-progress')).toHaveTextContent('25 / 20 XP today')
  })
})

describe('test renderer responses', () => {
  it('produce accepted and rejected answers for every test challenge', async () => {
    const { gradeResponse } = await import('@zaboon/session-engine')
    for (const c of testChallenges()) {
      expect(gradeResponse(c, correctResponse(c)).verdict).toBe('correct')
      expect(gradeResponse(c, wrongResponse(c)).verdict).toBe('wrong')
    }
  })
})

// ------------------------------------------------------------------------------------ the player
/** A sender that uses the fake api as is (the player tests don't exercise identity). */
function apiSender(api: ApiClient): OutboxSender {
  return {
    event: (id, body) => api('sessionEvent', { params: { id }, body }),
    complete: (id, body) => api('completeSession', { params: { id }, body }),
  }
}

function renderPlayer(
  opts: {
    api?: Partial<Record<string, (o: unknown) => unknown>>
    session?: ReturnType<typeof testSession>
    resolve?: RendererResolver
    settings?: Partial<Pick<Settings, 'keyboardLayout'>>
    flags?: Record<string, boolean>
    request?: LessonRequest
  } = {},
) {
  const calls: { name: string; opts: unknown }[] = []
  const api = (async (name: string, o: unknown) => {
    calls.push({ name, opts: o })
    const impl = opts.api?.[name]
    if (impl) return impl(o)
    if (name === 'createSession') return opts.session ?? testSession()
    if (name === 'sessionEvent')
      return { lives: { ...testSession().lives, count: 4 }, duplicate: false }
    if (name === 'completeSession') return testResult()
    throw new Error(`unexpected ${name}`)
  }) as unknown as ApiClient
  const auth = {} as AuthClient
  const snapshots = new MemorySnapshotStore()
  const outbox = new Outbox({
    store: new MemoryOutboxStore(),
    send: apiSender(api),
    currentUserId: () => USER_ID,
  })
  const onExit = vi.fn()
  const queryClient = new QueryClient()
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <AppServicesProvider auth={auth} api={api}>
        <LessonServicesProvider
          value={{
            snapshots,
            outbox,
            audio: createSilentAudio(),
            resolveRenderer: opts.resolve ?? resolveTestRenderer,
          }}
        >
          {children}
        </LessonServicesProvider>
      </AppServicesProvider>
    </QueryClientProvider>
  )
  const utils = render(
    wrap(
      <LessonPlayer
        request={opts.request ?? { courseId: 'fixture', kind: 'lesson', levelId: 'u01-s0' }}
        userId={USER_ID}
        settings={{ sound: false, transliteration: 'auto', vowelMarks: 'auto', ...opts.settings }}
        {...(opts.flags ? { flags: opts.flags } : {})}
        home={null}
        onExit={onExit}
      />,
    ),
  )
  return { ...utils, calls, onExit, snapshots, queryClient }
}

describe('LessonPlayer', () => {
  it('renderers get the keyboard layout and the persianKeyboard flag (off by default)', async () => {
    const first = renderPlayer()
    const plain = await screen.findByTestId('test-renderer')
    expect(plain).toHaveAttribute('data-keyboard-layout', 'standard')
    expect(plain).toHaveAttribute('data-persian-keyboard', 'false')
    first.unmount()
    renderPlayer({ settings: { keyboardLayout: 'phonetic' }, flags: { persianKeyboard: true } })
    const typed = await screen.findByTestId('test-renderer')
    expect(typed).toHaveAttribute('data-keyboard-layout', 'phonetic')
    expect(typed).toHaveAttribute('data-persian-keyboard', 'true')
  })

  it('Enter on a focused challenge button is left to the button; unfocused Enter checks', async () => {
    renderPlayer()
    await screen.findByTestId('test-renderer')
    fireEvent.click(screen.getByTestId('test-answer-correct'))
    const choice = screen.getByTestId('test-answer-wrong')
    choice.focus()
    const enter = fireEvent.keyDown(choice, { key: 'Enter' })
    expect(enter).toBe(true) // not preventDefault-ed: the button's own activation runs
    expect(screen.queryByTestId('lesson-feedback')).toBeNull()
    const roleButton = document.createElement('div')
    roleButton.setAttribute('role', 'button')
    roleButton.tabIndex = 0
    screen.getByTestId('test-renderer').appendChild(roleButton)
    fireEvent.keyDown(roleButton, { key: 'Enter' })
    expect(screen.queryByTestId('lesson-feedback')).toBeNull()
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(await screen.findByTestId('lesson-feedback')).toHaveAttribute('data-verdict', 'correct')
  })

  it('SKIP costs a heart and sends a wrong event', async () => {
    const { calls } = renderPlayer()
    await screen.findByTestId('test-renderer')
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(await screen.findByTestId('lesson-feedback')).toHaveAttribute('data-verdict', 'skipped')
    expect(screen.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '4')
    await waitFor(() => expect(calls.some((c) => c.name === 'sessionEvent')).toBe(true))
  })

  it('a remount while creating the session reuses the same createSession request', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const first = renderPlayer({
      api: {
        createSession: async () => {
          await gate
          return testSession()
        },
      },
    })
    await waitFor(() =>
      expect(first.calls.filter((c) => c.name === 'createSession')).toHaveLength(1),
    )
    first.unmount()
    const second = renderPlayer({ api: { createSession: async () => testSession() } })
    release()
    await screen.findByTestId('test-renderer')
    expect(second.calls.filter((c) => c.name === 'createSession')).toHaveLength(0)
  })

  it('plays a lesson with the keyboard: Enter checks and continues', async () => {
    const { calls, onExit, queryClient } = renderPlayer()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await screen.findByTestId('test-renderer')
    expect(calls[0]).toMatchObject({
      name: 'createSession',
      opts: { body: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-s0' } },
    })

    for (let i = 0; i < 3; i++) {
      await waitFor(() =>
        expect(screen.getByTestId('test-renderer')).toHaveAttribute('data-phase', 'answering'),
      )
      fireEvent.click(screen.getByTestId('test-answer-correct'))
      fireEvent.keyDown(document.body, { key: 'Enter' })
      expect(await screen.findByTestId('lesson-feedback')).toHaveAttribute(
        'data-verdict',
        'correct',
      )
      expect(screen.getByTestId('test-renderer')).toHaveAttribute('data-phase', 'feedback')
      fireEvent.keyDown(document.body, { key: 'Enter' })
    }
    await screen.findByTestId('complete-summary')
    const complete = calls.find((c) => c.name === 'completeSession')!
    expect(complete.opts).toMatchObject({ params: { id: testSession().sessionId } })
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['home'] }))
    // The Practice page's word list changes with every lesson too (#32).
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['words'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['path'] })

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByTestId('complete-streak')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByTestId('complete-goal')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(onExit).toHaveBeenCalledWith('/learn'))
  })

  it('P2: league change → quest progress after the goal, and the P2 queries refetch', async () => {
    const quest = {
      id: 'lessons_1',
      metric: 'lessons' as const,
      title: 'Complete a lesson',
      target: 1,
      progress: 1,
      completed: true,
      reward: 10,
      justCompleted: true,
    }
    const result = testResult({
      league: { tier: 'noqreh', weeklyXp: 15, rank: 3, previousRank: null, joinedNow: true },
      quests: [quest],
      coins: { earned: 10, total: 110 },
    })
    const { onExit, queryClient } = renderPlayer({ api: { completeSession: () => result } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await screen.findByTestId('test-renderer')
    for (let i = 0; i < 3; i++) {
      await waitFor(() =>
        expect(screen.getByTestId('test-renderer')).toHaveAttribute('data-phase', 'answering'),
      )
      fireEvent.click(screen.getByTestId('test-answer-correct'))
      fireEvent.keyDown(document.body, { key: 'Enter' })
      await screen.findByTestId('lesson-feedback')
      fireEvent.keyDown(document.body, { key: 'Enter' })
    }
    await screen.findByTestId('complete-summary')
    for (const key of ['leaderboard', 'quests', 'shop', 'practice'])
      await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] }))
    for (const id of ['complete-streak', 'complete-goal']) {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
      await screen.findByTestId(id)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const league = await screen.findByTestId('complete-league')
    expect(league).toHaveTextContent('You joined a league!')
    expect(league).toHaveTextContent('Noqreh League')
    expect(league).toHaveTextContent("You're #3 this week with 15 XP.")
    const fa = league.querySelector('[lang="fa"]')!
    expect(fa).toHaveAttribute('dir', 'rtl')
    expect(fa.textContent).toBe('نقره')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const quests = await screen.findByTestId('complete-quests')
    expect(quests).toHaveTextContent('Quest complete!')
    expect(screen.getByTestId('quests-coins')).toHaveTextContent('+10 coins')
    expect(screen.getByRole('progressbar', { name: 'Complete a lesson' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(onExit).toHaveBeenCalledWith('/learn'))
  })

  it('a practice hub mode reaches createSession', async () => {
    const { calls } = renderPlayer({
      request: { courseId: 'fixture', kind: 'practice', levelId: null, mode: 'listening' },
      session: { ...testSession(), kind: 'practice', levelId: null },
    })
    await screen.findByTestId('test-renderer')
    expect(calls[0]).toMatchObject({
      name: 'createSession',
      opts: { body: { courseId: 'fixture', kind: 'practice', mode: 'listening' } },
    })
  })

  it('a wrong answer costs a heart, sends the event and re-queues the challenge', async () => {
    const { calls } = renderPlayer()
    await screen.findByTestId('test-renderer')
    fireEvent.click(screen.getByTestId('test-answer-wrong'))
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByTestId('lesson-feedback')).toHaveAttribute('data-verdict', 'wrong')
    expect(screen.getByText('hello')).toBeInTheDocument() // the correct solution
    expect(screen.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '4')
    await waitFor(() => expect(calls.some((c) => c.name === 'sessionEvent')).toBe(true))
    expect(calls.find((c) => c.name === 'sessionEvent')!.opts).toEqual({
      params: { id: testSession().sessionId },
      body: { attemptSeq: 0, index: 0, kind: 'wrong' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() =>
      expect(screen.getByTestId('test-renderer')).toHaveAttribute('data-index', '1'),
    )
  })

  it('Escape opens "Wait, don\'t go!"; keep learning returns; end session exits', async () => {
    const { onExit } = renderPlayer()
    await screen.findByTestId('test-renderer')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(await screen.findByRole('dialog', { name: "Wait, don't go!" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep learning' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Quit lesson' }))
    await screen.findByRole('dialog', { name: "Wait, don't go!" })
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    await waitFor(() => expect(onExit).toHaveBeenCalledWith('/learn'))
  })

  it('out of hearts at the start offers practice', async () => {
    const err = Object.assign(new Error('no hearts left'), { code: 'out_of_lives' })
    const { onExit } = renderPlayer({
      api: {
        createSession: () => {
          throw err
        },
      },
    })
    const dialog = await screen.findByRole('dialog', { name: 'You ran out of hearts' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Practice to earn hearts' }))
    await waitFor(() => expect(onExit).toHaveBeenCalledWith('/lesson?course=fixture&kind=practice'))
  })

  it('a load failure can be retried', async () => {
    let n = 0
    renderPlayer({
      api: {
        createSession: () => {
          if (n++ === 0) throw Object.assign(new Error('offline'), { code: 'network' })
          return testSession()
        },
      },
    })
    expect(await screen.findByRole('alert')).toHaveAttribute('data-code', 'network')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    })
    await screen.findByTestId('test-renderer')
  })
})

/** The replayer needs the auth client (the outbox's sender reads { userId, token } from it). */
/** Signed in as whoever the replayer sends for (one stable fake auth client). */
const fakeAuth = {
  getSession: async () => {
    const u = outboxUser()
    return u ? { accessToken: 't', expiresAt: 0, userId: u, isAnonymous: true, email: null } : null
  },
} as unknown as AuthClient
const withAuth = (api: ApiClient, node: ReactNode) => (
  <AppServicesProvider api={api} auth={fakeAuth}>
    {node}
  </AppServicesProvider>
)

/**
 * The shared outbox sends through a client bound to the session's own token (real fetch), so these
 * tests stub `fetch` and look at the requests that go out.
 */
function stubFetch(respond: (url: string) => { status: number; body: unknown }) {
  const requests: { url: string; authorization: string | null }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      requests.push({ url, authorization: headers.get('authorization') })
      const r = respond(url)
      return new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
  return requests
}
const serverError = { status: 500, body: { error: { code: 'internal', message: 'boom' } } }
const eventOk = { status: 200, body: { lives: testSession().lives, duplicate: false } }
/** A fresh api identity per test, so each test gets its own shared outbox. */
const freshApi = () => (async () => undefined) as unknown as ApiClient

describe('OutboxReplayer', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends for the latest mounted user, resets on unmount, and shows a notice when a write gave up', async () => {
    const requests = stubFetch(() => serverError)
    const api = freshApi()
    expect(outboxUser()).toBeNull()
    const a = render(withAuth(api, <OutboxReplayer api={api} userId={USER_ID} />))
    const b = render(withAuth(api, <OutboxReplayer api={api} userId="guest-2" />))
    expect(outboxUser()).toBe('guest-2')
    b.unmount()
    expect(outboxUser()).toBe(USER_ID)

    const { outbox } = await sharedLessonStores(api)
    await outbox.enqueueEvent(USER_ID, testSession().sessionId, {
      attemptSeq: 0,
      index: 0,
      kind: 'wrong',
    })
    for (let i = 0; i < MAX_ATTEMPTS; i++) await act(() => outbox.flush())
    expect(requests).toHaveLength(MAX_ATTEMPTS)
    expect(requests[0]!.authorization).toBe('Bearer t')
    expect(await screen.findByTestId('outbox-notice')).toHaveTextContent("couldn't be saved")
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('outbox-notice')).toBeNull()

    a.unmount()
    expect(outboxUser()).toBeNull()
  })

  it('retagOutboxUser moves a merged guest’s writes to the account and sends them', async () => {
    const requests = stubFetch(() => eventOk)
    const api = freshApi()
    const view = render(withAuth(api, <OutboxReplayer api={api} userId="account-1" />))
    const { outbox } = await sharedLessonStores(api)
    await outbox.enqueueEvent('guest-1', 'guest-session', {
      attemptSeq: 0,
      index: 0,
      kind: 'wrong',
    })
    expect(await retagOutboxUser(api, 'guest-1', 'account-1')).toBe(1)
    await waitFor(() =>
      expect(requests.map((r) => r.url)).toEqual(['/api/sessions/guest-session/events']),
    )
    view.unmount()
  })
})

describe('OutboxReplayer notice is per user', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("a new user doesn't see the previous user's notice", async () => {
    stubFetch(() => serverError)
    const api = freshApi()
    const { outbox } = await sharedLessonStores(api)
    const view = render(withAuth(api, <OutboxReplayer api={api} userId="user-a" />))
    await outbox.enqueueEvent('user-a', 'sess-a', { attemptSeq: 0, index: 0, kind: 'wrong' })
    for (let i = 0; i < MAX_ATTEMPTS; i++) await act(() => outbox.flush())
    expect(await screen.findByTestId('outbox-notice')).toBeInTheDocument()
    view.rerender(withAuth(api, <OutboxReplayer api={api} userId="user-b" />))
    expect(screen.queryByTestId('outbox-notice')).toBeNull()
    view.unmount()
  })
})

describe('Enter on an already-selected choice', () => {
  it('means CHECK, not "select again"', async () => {
    renderPlayer()
    await screen.findByTestId('test-renderer')
    fireEvent.click(screen.getByTestId('test-answer-correct'))
    const card = document.createElement('button')
    card.className = 'card-3d zb-choice' // a ChoiceCard
    card.setAttribute('aria-pressed', 'true')
    screen.getByTestId('test-renderer').appendChild(card)
    card.focus()
    const notPrevented = fireEvent.keyDown(card, { key: 'Enter' })
    expect(notPrevented).toBe(false) // the card's own activation is suppressed
    expect(await screen.findByTestId('lesson-feedback')).toHaveAttribute('data-verdict', 'correct')
  })

  it('a focused, not-selected choice keeps its own Enter', async () => {
    renderPlayer()
    await screen.findByTestId('test-renderer')
    fireEvent.click(screen.getByTestId('test-answer-correct'))
    const card = document.createElement('button')
    card.className = 'card-3d zb-choice' // a ChoiceCard
    card.setAttribute('aria-pressed', 'false')
    screen.getByTestId('test-renderer').appendChild(card)
    card.focus()
    expect(fireEvent.keyDown(card, { key: 'Enter' })).toBe(true)
    expect(screen.queryByTestId('lesson-feedback')).toBeNull()
  })
})

describe('Enter with the real renderers (ws-renderers)', () => {
  /** A browser activates a focused button on an Enter keydown that nobody prevented. */
  const pressEnter = (el: HTMLElement) => {
    el.focus()
    const notPrevented = fireEvent.keyDown(el, { key: 'Enter' })
    if (notPrevented) fireEvent.click(el)
    return notPrevented
  }

  it('Enter on the selected select_translation card (a draft exists) is CHECK', async () => {
    const challenge = { ...fixture('select_translation'), index: 0 }
    renderPlayer({ session: testSession({ challenges: [challenge] }), resolve: rendererFor })
    const card = (await screen.findAllByRole('button', { pressed: false }))[0]!
    fireEvent.click(card)
    expect(card).toHaveAttribute('aria-pressed', 'true')
    expect(pressEnter(card)).toBe(false)
    expect(await screen.findByTestId('lesson-feedback')).toBeInTheDocument()
  })

  it('Enter on a half-selected match card is not CHECK: the card deselects', async () => {
    const challenge = { ...fixture('match_pairs'), index: 0 }
    renderPlayer({ session: testSession({ challenges: [challenge] }), resolve: rendererFor })
    const persian = await screen.findByRole('group', { name: 'Persian' })
    const card = within(persian).getAllByRole('button')[0]!
    fireEvent.click(card)
    expect(card).toHaveAttribute('aria-pressed', 'true')
    expect(pressEnter(card)).toBe(true) // left to the card
    expect(card).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('lesson-feedback')).toBeNull()
    expect(screen.getByTestId('lesson-check')).toHaveAttribute('data-variant', 'locked')
  })
})

describe('Enter on a placed build_word tile', () => {
  it('removes the letter (native), with no CHECK and no heart lost', async () => {
    const challenge = { ...fixture('build_word'), index: 0 }
    renderPlayer({ session: testSession({ challenges: [challenge] }), resolve: rendererFor })
    const letters = await screen.findByRole('group', { name: 'Letters' })
    const tile = within(letters).getAllByRole('button')[0]!
    fireEvent.click(tile) // one letter placed: the renderer reports a (partial) draft
    expect(tile).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('lesson-check')).toHaveAttribute('data-variant', 'primary')
    tile.focus()
    const notPrevented = fireEvent.keyDown(tile, { key: 'Enter' })
    expect(notPrevented).toBe(true) // left to the tile
    fireEvent.click(tile) // the browser's native Enter activation
    expect(tile).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('lesson-feedback')).toBeNull()
    expect(screen.getByTestId('lesson-hearts')).toHaveAttribute('data-count', '5')
  })
})
