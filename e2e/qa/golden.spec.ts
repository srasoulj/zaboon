/**
 * Golden path: plays the fixture course's u01-s0, u01-l1 and u01-l2 lessons through the REAL
 * challenge renderers (no `zaboon.testRenderers` flag) inside the real lesson player, against the
 * real API and local Postgres. Together the three levels cover all 13 MVP challenge types.
 *
 * Per challenge: the spec reads the session the player actually uses (the POST /api/sessions
 * response whose sessionId is the player's `data-session`), derives the UI actions that give the
 * correct answer (the same logic as components/challenges/fixtures/samples.ts, in
 * ./golden-answers.ts), and answers like a human (>= 1.1 s per challenge, so the anti-cheat awards
 * XP). Anything that goes wrong is recorded with the console errors and failed requests of that
 * step, and the lesson goes on when it can, so one run yields a precise bug list; each test fails
 * at the end if it recorded any bug. The report is attached to the test; set GOLDEN_SHOTS=1 to also
 * screenshot every phase into the test's output directory.
 *
 * Levels unlock in path order, so a fresh guest can only open u01-s0: the u01-l1 and u01-l2 tests
 * first finish the earlier levels through the API (perfect answers, human answer times), then play
 * their own level in the UI. Orchestrator-owned (ws-qa: don't edit; see ops/prompts/ws-qa.md).
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test'
import { expect, test, type Guest } from '../fixtures'
import {
  choiceLabel,
  correctResponse,
  describeAnswer,
  formatDuration,
  matchSeed,
  plain,
  seededOrder,
  solveGraph,
  tileIndexes,
  type Challenge,
} from './golden-answers'

// ------------------------------------------------------------------------------------ settings
const COURSE = 'fixture'
/** Screenshots of every phase are opt-in: they are slow, and the report pinpoints failures. */
const SHOTS = process.env.GOLDEN_SHOTS === '1'
/** The anti-cheat awards no XP when the median answer is under 800 ms: answer like a human. */
const HUMAN_MS = 1_100
/** How long a renderer gets to show its controls before it counts as broken. */
const UI_TIMEOUT = 10_000
/** A challenge shown more often than this ends the run (the lesson can't finish without it). */
const MAX_TRIES = 2

interface LevelSpec {
  level: string
  /** Earlier path levels a fresh guest has to finish first. */
  prereqs: string[]
  /** The pinned challenge types in order (content/fixtures/units/u01-fixture.yaml). */
  types: string[]
}

const LEVELS: LevelSpec[] = [
  {
    level: 'u01-s0',
    prereqs: [],
    types: ['select_translation', 'translate_bank', 'translate_type', 'match_pairs'],
  },
  {
    level: 'u01-l1',
    prereqs: ['u01-s0'],
    types: [
      'select_image',
      'select_translation',
      'translate_bank',
      'translate_bank',
      'translate_type',
      'match_pairs',
      'listen_tap',
      'cloze_choice',
      'complete_chat',
    ],
  },
  {
    level: 'u01-l2',
    prereqs: ['u01-s0', 'u01-l1'],
    types: ['letter_intro', 'letter_sound', 'letter_forms', 'read_word', 'build_word'],
  },
]

// ------------------------------------------------------------------- API shapes (contracts)
interface Session {
  sessionId: string
  kind: string
  levelId: string | null
  graderVersion: number
  challenges: Challenge[]
  lives: { policy: string; count: number }
}

interface SessionResult {
  sessionId: string
  xp: { base: number; bonus: number; total: number }
  accuracy: number
  perfect: boolean
  durationMs: number
  streak: { current: number; extendedToday: boolean }
  dailyGoal: { xp: number; goal: number; met: boolean; justMet: boolean }
  lives: { count: number }
  level: { levelId: string; lessonsDone: number; lessonsTotal: number; completed: boolean } | null
  graderMismatches: number
}

interface Home {
  xpTotal: number
  streak: { current: number; status: string }
  dailyGoal: { xp: number; goal: number; met: boolean }
  lives: { count: number; policy: string }
}

interface PathResponse {
  sections: { units: { levels: { id: string; state: string }[] }[] }[]
}

/** ANSI colour codes (ESC [ … m), built from a string so the regex has no literal control char. */
const ANSI_COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

/** First lines of an error, without ANSI colours. */
function brief(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return text
    .replace(ANSI_COLOUR, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(' | ')
}

// ---------------------------------------------------------------------------------- recorder
interface Bug {
  project: string
  level: string
  step: string
  type: string
  what: string
  evidence: Record<string, unknown>
}

interface LogEntry {
  step: string
  kind: string
  text: string
}

interface ChallengeRun {
  step: string
  index: number
  type: string
  attempt: number
  expected: string
  verdict: string | null
  outcome: 'passed' | 'failed' | 'stuck' | 'pending'
  ms: number
  /** Matching pairs that did not lock (a wrong tap costs a heart). */
  mismatches: number
  notes: string[]
  shots: string[]
  console?: LogEntry[]
}

class Recorder {
  readonly bugs: Bug[] = []
  readonly notes: string[] = []
  readonly log: LogEntry[] = []
  readonly network: LogEntry[] = []
  readonly runs: ChallengeRun[] = []
  readonly dir: string
  readonly project: string
  step = 'setup'
  type = '-'

  constructor(
    readonly page: Page,
    readonly info: TestInfo,
    readonly level: string,
  ) {
    this.project = info.project.name
    this.dir = info.outputPath('golden')
    if (SHOTS) mkdirSync(this.dir, { recursive: true })
    page.on('console', (m) => {
      const kind = m.type()
      if (kind === 'error' || kind === 'warning' || kind === 'assert')
        this.log.push({ step: this.step, kind, text: m.text().slice(0, 3000) })
    })
    page.on('pageerror', (e) =>
      this.log.push({
        step: this.step,
        kind: 'pageerror',
        text: `${e.name}: ${e.message}\n${e.stack ?? ''}`.slice(0, 4000),
      }),
    )
    page.on('requestfailed', (r) =>
      this.network.push({
        step: this.step,
        kind: 'requestfailed',
        text: `${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`,
      }),
    )
    page.on('response', (r) => {
      if (r.status() >= 400)
        this.network.push({
          step: this.step,
          kind: `http ${r.status()}`,
          text: `${r.request().method()} ${r.url()}`,
        })
    })
  }

  bug(what: string, evidence: Record<string, unknown> = {}): void {
    this.bugs.push({
      project: this.project,
      level: this.level,
      step: this.step,
      type: this.type,
      what,
      evidence,
    })
    console.log(`    BUG [${this.project} ${this.level} ${this.step}] ${what}`)
  }

  /** Runs a UI expectation; a failure becomes a bug instead of ending the test. */
  async soft(what: string, fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn()
      return true
    } catch (e) {
      this.bug(`${what}: ${brief(e)}`)
      return false
    }
  }

  async shot(name: string): Promise<string> {
    const file = `${this.level}-${name}.png`
    if (!SHOTS) return file
    try {
      await this.page.screenshot({
        path: join(this.dir, file),
        fullPage: true,
        animations: 'disabled',
        timeout: 20_000,
      })
    } catch (e) {
      this.notes.push(`screenshot ${file} failed: ${brief(e)}`)
    }
    return file
  }

  async finish(extra: Record<string, unknown>): Promise<void> {
    for (const b of this.bugs) {
      const logs = this.log.filter((l) => l.step === b.step)
      const net = this.network.filter((l) => l.step === b.step)
      if (logs.length > 0) b.evidence.console = logs
      if (net.length > 0) b.evidence.network = net
    }
    for (const r of this.runs) {
      const logs = this.log.filter((l) => l.step === r.step)
      if (logs.length > 0) r.console = logs
    }
    const report = {
      project: this.project,
      level: this.level,
      bugs: this.bugs,
      runs: this.runs,
      notes: this.notes,
      ...extra,
      console: this.log,
      network: this.network,
    }
    const body = JSON.stringify(report, null, 2)
    await this.info.attach(`${this.level}-report.json`, { body, contentType: 'application/json' })
  }
}

// ------------------------------------------------------------------------------- API helpers
async function getHome(request: APIRequestContext, guest: Guest): Promise<Home> {
  const res = await request.get('/api/home', { headers: { authorization: guest.authorization } })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as Home
}

async function levelState(
  request: APIRequestContext,
  guest: Guest,
  levelId: string,
): Promise<string | null> {
  const res = await request.get(`/api/path?courseId=${COURSE}`, {
    headers: { authorization: guest.authorization },
  })
  if (!res.ok()) return `http ${res.status()}`
  const path = (await res.json()) as PathResponse
  for (const s of path.sections)
    for (const u of s.units) for (const l of u.levels) if (l.id === levelId) return l.state
  return null
}

/** Plays a level through the API with perfect answers (a prerequisite of a later level). */
async function completeViaApi(
  request: APIRequestContext,
  guest: Guest,
  levelId: string,
  tz: string,
  rec: Recorder,
): Promise<SessionResult | null> {
  rec.step = `api ${levelId}`
  rec.type = 'api'
  const headers = { authorization: guest.authorization }
  const res = await request.post('/api/sessions', {
    headers,
    data: { courseId: COURSE, kind: 'lesson', levelId, tz },
  })
  if (res.status() !== 200) {
    rec.bug(`POST /api/sessions for ${levelId} answered ${res.status()}`, { body: await res.text() })
    return null
  }
  const session = (await res.json()) as Session
  const answers = session.challenges.map((c, k) => ({
    index: c.index,
    attemptSeq: k,
    response: correctResponse(c),
    verdict: 'correct',
    ms: 1_500,
    hinted: false,
  }))
  const done = await request.post(`/api/sessions/${session.sessionId}/complete`, {
    headers,
    data: {
      answers,
      completedAt: new Date().toISOString(),
      graderVersion: session.graderVersion,
    },
  })
  if (done.status() !== 200) {
    rec.bug(`POST /complete for ${levelId} answered ${done.status()}`, { body: await done.text() })
    return null
  }
  const result = (await done.json()) as SessionResult
  if (result.graderMismatches !== 0)
    rec.bug(
      `the server grader rejects ${result.graderMismatches} of the derived correct answers for ${levelId}`,
      { answers },
    )
  if (!result.level?.completed) rec.bug(`${levelId} is not completed`, { level: result.level })
  if (result.xp.total <= 0) rec.bug(`${levelId} through the API earned no XP`, { xp: result.xp })
  rec.notes.push(
    `${levelId} completed through the API: +${result.xp.total} XP, streak ${result.streak.current} ` +
      `(extendedToday ${result.streak.extendedToday}), goal ${result.dailyGoal.xp}/${result.dailyGoal.goal}`,
  )
  return result
}

// ------------------------------------------------------------------------------ player helpers
type PlayerState = 'answering' | 'complete' | 'error' | 'expired' | 'outOfHearts' | 'left' | 'timeout'

/** Waits until the player shows one of its states (answering = the CHECK footer is up). */
async function nextState(page: Page, timeout: number): Promise<PlayerState> {
  const probes: [PlayerState, Locator][] = [
    ['answering', page.getByTestId('lesson-check')],
    ['complete', page.getByTestId('complete-summary')],
    ['error', page.getByTestId('lesson-error')],
    ['expired', page.getByTestId('lesson-expired')],
    ['outOfHearts', page.getByTestId('hearts-practice')],
  ]
  const deadline = Date.now() + timeout
  do {
    for (const [state, probe] of probes)
      if (await probe.isVisible().catch(() => false)) return state
    if (!new URL(page.url()).pathname.startsWith('/lesson')) return 'left'
    await page.waitForTimeout(200)
  } while (Date.now() < deadline)
  return 'timeout'
}

interface ButtonInfo {
  /** Persian words (FaText) joined by spaces; '' for plain labels. */
  words: string
  /** The card's label text. */
  text: string
}

async function buttonsIn(group: Locator): Promise<ButtonInfo[]> {
  return group.getByRole('button').evaluateAll((els) =>
    els.map((el) => ({
      words: Array.from(el.querySelectorAll('.zb-fa__word'), (w) => w.textContent ?? '').join(' '),
      text: (el.querySelector('.zb-choice__label')?.textContent ?? el.textContent ?? '').trim(),
    })),
  )
}

/** What a choice card shows: its Persian words, or its label text. */
async function cardText(card: Locator): Promise<string> {
  const [info] = await card.evaluateAll((els) =>
    els.map((el) => {
      const words = Array.from(el.querySelectorAll('.zb-fa__word'), (w) => w.textContent ?? '')
      if (words.length > 0) return words.join(' ')
      return (el.querySelector('.zb-choice__label')?.textContent ?? el.textContent ?? '').trim()
    }),
  )
  return info ?? ''
}

const choiceGroup = (main: Locator, c: Challenge) =>
  main.getByRole('group', { name: c.type === 'complete_chat' ? 'Replies' : 'Choices', exact: true })

/**
 * Performs the UI actions that give the correct answer. Returns true when the renderer submits by
 * itself (matching: the last pair CHECKs); then it has already paused and taken the
 * "answered" screenshot before the last tap.
 */
async function enterAnswer(
  main: Locator,
  c: Challenge,
  rec: Recorder,
  run: ChallengeRun,
  pause: () => Promise<void>,
  shotAnswered: () => Promise<void>,
): Promise<boolean> {
  switch (c.type) {
    case 'select_image':
    case 'select_translation':
    case 'cloze_choice':
    case 'complete_chat':
    case 'letter_sound':
    case 'read_word': {
      // Choice cards (ChoiceList): one aria-pressed button per choice, in session order.
      const cards = choiceGroup(main, c).getByRole('button')
      await expect(cards).toHaveCount(c.choices.length, { timeout: UI_TIMEOUT })
      const card = cards.nth(c.answer)
      const want = choiceLabel(c)
      const shown = await cardText(card)
      if (plain(shown) !== plain(want))
        rec.bug(`choice ${c.answer + 1} reads "${shown}" but the session's answer is "${want}"`)
      await rec.soft('the card has no digit hint for its position', () =>
        expect(card).toHaveAttribute('aria-keyshortcuts', String(c.answer + 1)),
      )
      await card.click()
      await expect(card).toHaveAttribute('aria-pressed', 'true')
      if (c.type === 'cloze_choice')
        await rec.soft('the blank does not show the chosen word', () =>
          expect(main.getByTestId('cloze-blank')).toHaveText(c.choices[c.answer]!),
        )
      return false
    }
    case 'translate_bank':
    case 'listen_tap': {
      if (c.type === 'listen_tap')
        await rec.soft('the "Play audio" button', () =>
          main.getByRole('button', { name: 'Play audio', exact: true }).click(),
        )
      const words = solveGraph(c.graph, c.bank)
      if (!words) throw new Error(`no accepted answer can be built from ${JSON.stringify(c.bank)}`)
      // Word bank (TileBank): whole-word tiles; a placed tile leaves a placeholder behind.
      const bank = main.getByRole('group', { name: 'Word bank', exact: true })
      const line = main.getByRole('group', { name: 'Your answer', exact: true })
      await expect(bank.getByRole('button')).toHaveCount(c.bank.length, { timeout: UI_TIMEOUT })
      for (const w of words) await bank.getByRole('button', { name: w, exact: true }).first().click()
      await expect(line.getByRole('button')).toHaveText(words)
      return false
    }
    case 'translate_type': {
      const text = (solveGraph(c.graph) ?? []).join(' ')
      if (!text) throw new Error('the answer graph has no accepted path')
      const box = main.getByRole('textbox')
      await box.click()
      await box.pressSequentially(text, { delay: 25 })
      await expect(box).toHaveValue(text)
      return false
    }
    case 'match_pairs':
    case 'letter_forms': {
      const isPairs = c.type === 'match_pairs'
      const left = main.getByRole('group', { name: isPairs ? 'Persian' : 'Letters', exact: true })
      const right = main.getByRole('group', {
        name: isPairs ? 'English' : 'Joined forms',
        exact: true,
      })
      const n = c.pairs.length
      await expect(left.getByRole('button')).toHaveCount(n, { timeout: UI_TIMEOUT })
      await expect(right.getByRole('button')).toHaveCount(n, { timeout: UI_TIMEOUT })
      // Pair i is (left[i], right[i]); both columns are shuffled for display. Find each item by
      // its content, falling back to the renderer's seeded order.
      const leftKeys =
        c.type === 'match_pairs' ? c.pairs.map((p) => plain(p.fa.fa)) : c.pairs.map((p) => p.left)
      const rightKeys =
        c.type === 'match_pairs' ? c.pairs.map((p) => p.en) : c.pairs.map((p) => p.right)
      const seed = matchSeed(c)
      const leftShown = (await buttonsIn(left)).map((b) => (isPairs ? plain(b.words || b.text) : b.text))
      const rightShown = (await buttonsIn(right)).map((b) => b.text)
      const locate = (shown: string[], keys: string[], seeded: number[], side: string) => {
        const byContent = keys.map((k) => shown.indexOf(k))
        const bySeed = keys.map((_, i) => seeded.indexOf(i))
        if (byContent.some((p) => p < 0) || new Set(byContent).size !== keys.length) {
          run.notes.push(`${side}: located by seeded order (shown ${JSON.stringify(shown)})`)
          return bySeed
        }
        if (byContent.join() !== bySeed.join())
          run.notes.push(`${side}: display order differs from the replicated seededOrder`)
        return byContent
      }
      const lp = locate(leftShown, leftKeys, seededOrder(n, `${seed}:l`), 'left')
      const rp = locate(rightShown, rightKeys, seededOrder(n, `${seed}:r`), 'right')
      for (let i = 0; i < n; i++) {
        if (i === n - 1) {
          await pause()
          await shotAnswered()
        }
        const l = left.getByRole('button').nth(lp[i]!)
        const r = right.getByRole('button').nth(rp[i]!)
        await l.click()
        await r.click()
        if (i < n - 1) {
          const locked = await rec.soft(
            `pair ${i + 1} (${leftKeys[i]} = ${rightKeys[i]}) did not lock as matched`,
            async () => {
              await expect(l).toHaveAttribute('data-matched', 'true')
              await expect(r).toHaveAttribute('data-matched', 'true')
            },
          )
          if (!locked) run.mismatches++
        }
      }
      return true
    }
    case 'letter_intro':
      await rec.soft('the letter card does not show four forms', () =>
        expect(main.locator('[data-form]')).toHaveCount(4),
      )
      return false
    case 'build_word': {
      const tiles = main.getByRole('group', { name: 'Letters', exact: true }).getByRole('button')
      await expect(tiles).toHaveCount(c.tiles.length, { timeout: UI_TIMEOUT })
      const picks = tileIndexes(c.tiles, c.answer)
      if (picks.length !== c.answer.length)
        throw new Error(`tiles ${JSON.stringify(c.tiles)} cannot spell ${JSON.stringify(c.answer)}`)
      for (const i of picks) {
        await tiles.nth(i).click()
        await expect(tiles.nth(i)).toHaveAttribute('aria-pressed', 'true')
      }
      await expect(main.getByTestId('assembled-word')).toHaveText(c.answer.join(''))
      return false
    }
  }
}

/** The renderer's graded look after a correct CHECK. */
async function checkGradedLook(main: Locator, c: Challenge, rec: Recorder): Promise<void> {
  switch (c.type) {
    case 'select_image':
    case 'select_translation':
    case 'cloze_choice':
    case 'complete_chat':
    case 'letter_sound':
    case 'read_word':
      await rec.soft('the chosen card is not marked correct in feedback', () =>
        expect(choiceGroup(main, c).getByRole('button').nth(c.answer)).toHaveAttribute(
          'data-state',
          'correct',
        ),
      )
      return
    case 'translate_bank':
    case 'listen_tap':
      await rec.soft('the answer line is not marked correct in feedback', () =>
        expect(main.getByRole('group', { name: 'Your answer', exact: true })).toHaveAttribute(
          'data-state',
          'correct',
        ),
      )
      if (c.type === 'listen_tap')
        await rec.soft('no transcript after CHECK', () =>
          expect(main.getByRole('group', { name: 'Transcript', exact: true })).toBeVisible(),
        )
      return
    case 'translate_type':
      await rec.soft('the answer field is not marked correct in feedback', () =>
        expect(main.getByRole('textbox')).toHaveAttribute('data-state', 'correct'),
      )
      return
    case 'build_word':
      await rec.soft('the assembled word is not marked correct in feedback', () =>
        expect(main.getByTestId('assembled-word').locator('..')).toHaveAttribute(
          'data-state',
          'correct',
        ),
      )
      return
    default:
      return
  }
}

type Outcome = 'passed' | 'failed' | 'stuck'

/** One showing of one challenge: answer it, CHECK, screenshot, CONTINUE. */
async function playChallenge(
  page: Page,
  rec: Recorder,
  c: Challenge,
  attempt: number,
): Promise<Outcome> {
  const shownAt = Date.now()
  const main = page.getByTestId('lesson-challenge')
  const check = page.getByTestId('lesson-check')
  const feedback = page.getByTestId('lesson-feedback')
  const shotName = (phase: string) =>
    `${c.index}-${c.type}-${phase}${attempt > 1 ? `-try${attempt}` : ''}`
  const run: ChallengeRun = {
    step: rec.step,
    index: c.index,
    type: c.type,
    attempt,
    expected: describeAnswer(c),
    verdict: null,
    outcome: 'pending',
    ms: 0,
    mismatches: 0,
    notes: [],
    shots: [],
  }
  rec.runs.push(run)
  const pause = async () => {
    const left = HUMAN_MS - (Date.now() - shownAt)
    if (left > 0) await page.waitForTimeout(left)
  }
  const shotAnswered = async () => {
    run.shots.push(await rec.shot(shotName('answered')))
  }

  // The real renderer mounted: its ChallengeFrame section carries data-challenge=<type>.
  const rendered = await rec.soft('the real renderer did not render', () =>
    expect(main.locator(`[data-challenge="${c.type}"]`)).toBeVisible({ timeout: UI_TIMEOUT }),
  )
  run.shots.push(await rec.shot(shotName('answering')))

  let entered = false
  let autoSubmits = false
  if (rendered) {
    try {
      autoSubmits = await enterAnswer(main, c, rec, run, pause, shotAnswered)
      entered = true
    } catch (e) {
      rec.bug(`could not enter the correct answer (${run.expected}): ${brief(e)}`)
      await shotAnswered()
    }
  }

  // CHECK: matching renderers submit themselves after the last pair; translate_type uses Enter.
  let checked = entered && autoSubmits
  if (entered && !autoSubmits) {
    const ready = await rec.soft('CHECK stayed locked after entering the answer', () =>
      expect(check).toHaveAttribute('data-variant', 'primary', { timeout: 5_000 }),
    )
    await pause()
    await shotAnswered()
    if (ready && c.type === 'translate_type') {
      // Enter in the answer field checks (DESIGN-SYSTEM §8).
      await main.getByRole('textbox').press('Enter')
      const viaEnter = await feedback.waitFor({ state: 'visible', timeout: 4_000 }).then(
        () => true,
        () => false,
      )
      if (!viaEnter) {
        rec.bug('Enter in the answer field did not CHECK')
        await check.click()
      }
      checked = true
    } else if (ready) {
      await check.click()
      checked = true
    }
  }

  let shown =
    checked &&
    (await feedback.waitFor({ state: 'visible', timeout: 10_000 }).then(
      () => true,
      () => false,
    ))
  if (!shown) {
    if (checked)
      rec.bug(
        autoSubmits
          ? 'no feedback: the renderer did not submit itself after the last pair'
          : 'no feedback after CHECK',
      )
    run.notes.push('skipped so the lesson can go on')
    await page
      .getByTestId('lesson-skip')
      .click({ timeout: 5_000 })
      .catch(() => {})
    shown = await feedback.waitFor({ state: 'visible', timeout: 10_000 }).then(
      () => true,
      () => false,
    )
    if (!shown) {
      rec.bug('stuck: neither CHECK nor SKIP shows the feedback bar')
      run.shots.push(await rec.shot(shotName('stuck')))
      run.outcome = 'stuck'
      return 'stuck'
    }
  }
  run.ms = Date.now() - shownAt
  const verdict = await feedback.getAttribute('data-verdict')
  run.verdict = verdict
  await page.waitForTimeout(400) // the feedback bar slides up
  run.shots.push(await rec.shot(shotName('feedback')))
  const passed = verdict === 'correct' || verdict === 'typo' || verdict === 'spelling'
  if (checked && !passed)
    rec.bug(`the correct answer (${run.expected}) was graded "${verdict}"`, {
      feedback: await feedback.innerText().catch(() => ''),
    })
  if (passed && verdict !== 'correct') run.notes.push(`accepted as ${verdict}`)
  if (passed) await checkGradedLook(main, c, rec)

  await feedback.getByRole('button', { name: 'Continue', exact: true }).click()
  await rec.soft('the feedback bar did not close after Continue', () =>
    expect(feedback).toBeHidden({ timeout: 10_000 }),
  )
  run.outcome = passed ? 'passed' : 'failed'
  console.log(
    `    ${passed ? 'ok ' : 'BAD'} [${rec.project}] ${rec.level} #${c.index} ${c.type}` +
      `${attempt > 1 ? ` (try ${attempt})` : ''}: ${verdict} after ${run.ms} ms`,
  )
  return run.outcome
}

type Screen = 'complete-summary' | 'complete-streak' | 'complete-goal' | 'left' | 'unknown'

async function whichScreen(page: Page): Promise<Screen> {
  const screens: Screen[] = ['complete-summary', 'complete-streak', 'complete-goal']
  const deadline = Date.now() + 20_000
  do {
    for (const s of screens) if (await page.getByTestId(s).isVisible().catch(() => false)) return s
    if (!new URL(page.url()).pathname.startsWith('/lesson')) return 'left'
    await page.waitForTimeout(200)
  } while (Date.now() < deadline)
  return 'unknown'
}

/** XP/accuracy/time → streak → daily goal → back to the path, checked against the server result. */
async function stepThroughComplete(
  page: Page,
  rec: Recorder,
  result: SessionResult | null,
  clean: boolean,
  levelId: string,
): Promise<string[]> {
  const next = page.getByTestId('complete-continue')
  const expected: Screen[] = ['complete-summary']
  if (result?.streak.extendedToday) expected.push('complete-streak')
  if (result?.dailyGoal.justMet) expected.push('complete-goal')

  if (result) {
    if (result.xp.total <= 0) rec.bug(`the lesson earned ${result.xp.total} XP`, { xp: result.xp })
    if (result.graderMismatches !== 0)
      rec.bug(`the server grader disagreed with ${result.graderMismatches} client verdict(s)`)
    if (result.level?.levelId !== levelId || !result.level.completed)
      rec.bug(`${levelId} is not completed after the lesson`, { level: result.level })
    if (clean && (!result.perfect || result.accuracy !== 1))
      rec.bug('a lesson answered right first time is not perfect / 100%', {
        perfect: result.perfect,
        accuracy: result.accuracy,
      })
  }

  const seen: Screen[] = []
  for (let k = 0; k < 4; k++) {
    const screen = await whichScreen(page)
    if (screen === 'left' || screen === 'unknown') break
    seen.push(screen)
    if (screen === 'complete-summary') {
      const summary = page.getByTestId('complete-summary')
      await rec.soft('the summary is not from the server', () =>
        expect(summary).toHaveAttribute('data-source', 'server', { timeout: 15_000 }),
      )
      if (result) {
        await rec.soft('summary XP', () =>
          expect(page.getByTestId('complete-xp')).toHaveAttribute('data-value', String(result.xp.total)),
        )
        await rec.soft('summary accuracy', () =>
          expect(page.getByTestId('complete-accuracy')).toHaveAttribute(
            'data-value',
            `${Math.round(result.accuracy * 100)}%`,
          ),
        )
        await rec.soft('summary time', () =>
          expect(page.getByTestId('complete-time')).toHaveAttribute(
            'data-value',
            formatDuration(result.durationMs),
          ),
        )
        await rec.soft('summary title', () =>
          expect(summary.getByRole('heading', { level: 1 })).toHaveText(
            result.perfect ? 'Perfect lesson!' : 'Lesson complete!',
          ),
        )
      }
      await page.waitForTimeout(1_200) // count-ups and confetti
      await rec.shot('complete-1-summary')
    } else if (screen === 'complete-streak') {
      if (result)
        await rec.soft('streak days', () =>
          expect(page.getByTestId('streak-days')).toHaveAttribute(
            'data-value',
            String(result.streak.current),
          ),
        )
      await page.waitForTimeout(1_000)
      await rec.shot('complete-2-streak')
    } else {
      if (result)
        await rec.soft('daily goal progress', () =>
          expect(page.getByTestId('goal-progress')).toHaveText(
            `${result.dailyGoal.xp} / ${result.dailyGoal.goal} XP today`,
          ),
        )
      await page.waitForTimeout(600)
      await rec.shot('complete-3-goal')
    }
    await next.click()
    await rec.soft(`${screen} did not go away after Continue`, () =>
      expect(page.getByTestId(screen)).toBeHidden({ timeout: 10_000 }),
    )
  }
  if (seen.join() !== expected.join())
    rec.bug(`complete screens: saw [${seen.join(', ')}], the server result implies [${expected.join(', ')}]`)
  await rec.soft('the player did not return to the path', () =>
    expect(page).toHaveURL(/\/(learn|onboarding)(?:[?#]|$)/, { timeout: 30_000 }),
  )
  await page.waitForTimeout(500)
  await rec.shot('complete-4-exit')
  return seen
}

// ----------------------------------------------------------------------------------- the run
async function playLevel(
  page: Page,
  request: APIRequestContext,
  guest: Guest,
  rec: Recorder,
  spec: LevelSpec,
  extra: Record<string, unknown>,
): Promise<void> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  // 1. Levels unlock in order: finish the earlier ones through the API.
  let home = await getHome(request, guest)
  extra.homeAtStart = home
  for (const level of spec.prereqs) {
    const before = home.xpTotal
    await completeViaApi(request, guest, level, tz, rec)
    home = await getHome(request, guest)
    if (!(home.xpTotal > before))
      rec.bug(`xpTotal did not increase after ${level} (API): ${before} -> ${home.xpTotal}`)
  }
  const homeBefore = home
  extra.homeBefore = homeBefore
  rec.step = 'setup'
  rec.type = 'setup'
  const stateBefore = await levelState(request, guest, spec.level)
  if (stateBefore !== 'current')
    rec.bug(`${spec.level} should be the current level before playing, it is "${stateBefore}"`)

  // 2. Open the lesson; keep every session the page creates and every completion it gets back.
  const created = new Map<string, Session>()
  const completed = new Map<string, SessionResult>()
  page.on('response', async (r) => {
    if (r.request().method() !== 'POST' || !r.ok()) return
    const path = new URL(r.url()).pathname
    const done = /^\/api\/sessions\/([^/]+)\/complete$/.exec(path)
    if (path !== '/api/sessions' && !done) return
    try {
      const body: unknown = await r.json()
      if (done) completed.set(done[1]!, body as SessionResult)
      else created.set((body as Session).sessionId, body as Session)
    } catch (e) {
      rec.notes.push(`could not read the ${path} response: ${brief(e)}`)
    }
  })

  rec.step = 'load'
  rec.type = 'load'
  const firstCreate = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/sessions',
    { timeout: 180_000 },
  )
  await page.goto(`/lesson?course=${COURSE}&kind=lesson&level=${spec.level}`)
  const createRes = await firstCreate
  if (createRes.status() !== 200)
    rec.bug(`POST /api/sessions answered ${createRes.status()}`, {
      body: await createRes.text().catch(() => ''),
    })

  let state = await nextState(page, 180_000)
  if (state !== 'answering') {
    rec.bug(`the lesson did not start (player state: ${state})`, {
      text: (await page.locator('body').innerText().catch(() => '')).slice(0, 1_000),
    })
    await rec.shot('load-failed')
    return
  }
  const sessionId = await page.getByTestId('lesson-player').getAttribute('data-session')
  if (!sessionId) throw new Error('the lesson player has no data-session')
  await expect
    .poll(() => created.has(sessionId), {
      message: 'the POST /api/sessions response of the session the player uses',
      timeout: 15_000,
    })
    .toBe(true)
  const session = created.get(sessionId)!
  extra.sessionId = sessionId
  extra.sessionsCreatedByPage = [...created.keys()]
  extra.challenges = session.challenges.map((c) => ({
    index: c.index,
    type: c.type,
    expected: describeAnswer(c),
  }))
  const types = session.challenges.map((c) => c.type)
  if (types.join() !== spec.types.join())
    rec.bug('the session is not the pinned challenge list', { expected: spec.types, actual: types })
  const heartsAtStart = await page
    .getByTestId('lesson-hearts')
    .getAttribute('data-count')
    .catch(() => null)
  extra.heartsAtStart = heartsAtStart
  console.log(
    `  [${rec.project}] ${spec.level}: session ${sessionId} (${types.join(', ')}), hearts ${heartsAtStart}`,
  )

  // 3. Play every challenge in the order the player shows them.
  const tries = new Map<number, number>()
  const order: number[] = []
  while (state === 'answering') {
    const main = page.getByTestId('lesson-challenge')
    const index = Number(await main.getAttribute('data-index'))
    const domType = await main.getAttribute('data-type')
    const c = session.challenges.find((x) => x.index === index)
    const attempt = (tries.get(index) ?? 0) + 1
    tries.set(index, attempt)
    rec.type = c?.type ?? domType ?? '?'
    rec.step = `#${index} ${rec.type}${attempt > 1 ? ` try ${attempt}` : ''}`
    if (!c) {
      rec.bug(`the player shows challenge ${index}, which is not in the session`)
      await rec.shot(`${index}-unknown`)
      return
    }
    if (domType !== c.type) rec.bug(`the player's data-type is "${domType}", the session says ${c.type}`)
    if (attempt > MAX_TRIES) {
      rec.bug(`challenge ${index} is back for try ${attempt}: giving up, the lesson cannot finish`)
      await rec.shot(`${index}-${c.type}-given-up`)
      return
    }
    order.push(index)
    const outcome = await test.step(rec.step, () => playChallenge(page, rec, c, attempt))
    if (outcome === 'stuck') return
    state = await nextState(page, 60_000)
  }
  extra.order = order
  const clean =
    rec.runs.length === session.challenges.length &&
    rec.runs.every((r) => r.verdict === 'correct' && r.mismatches === 0)
  if (clean && order.join() !== session.challenges.map((c) => c.index).join())
    rec.bug(`the player did not show the challenges in session order: ${order.join(', ')}`)

  rec.step = 'complete'
  rec.type = 'complete'
  if (state !== 'complete') {
    rec.bug(`the lesson ended in state "${state}" instead of the complete screens`, {
      text: (await page.locator('body').innerText().catch(() => '')).slice(0, 1_000),
    })
    await rec.shot(`end-${state}`)
    return
  }

  // 4. The complete screens, checked against the server's SessionResult.
  const result = await expect
    .poll(() => completed.has(sessionId), { timeout: 15_000 })
    .toBe(true)
    .then(
      () => completed.get(sessionId) ?? null,
      () => null,
    )
  if (!result) rec.bug('no POST /api/sessions/:id/complete response was seen for the session')
  extra.result = result
  extra.completeScreens = await test.step('complete screens', () =>
    stepThroughComplete(page, rec, result, clean, spec.level),
  )

  // 5. Home: XP went up by what the lesson earned; the level is completed.
  rec.step = 'after'
  rec.type = 'after'
  const homeAfter = await getHome(request, guest)
  extra.homeAfter = homeAfter
  if (!(homeAfter.xpTotal > 0)) rec.bug(`xpTotal is ${homeAfter.xpTotal} after the lesson`)
  if (!(homeAfter.xpTotal > homeBefore.xpTotal))
    rec.bug(`xpTotal did not increase: ${homeBefore.xpTotal} -> ${homeAfter.xpTotal}`)
  if (result && homeAfter.xpTotal - homeBefore.xpTotal !== result.xp.total)
    rec.bug(
      `xpTotal went ${homeBefore.xpTotal} -> ${homeAfter.xpTotal}, the lesson reported +${result.xp.total}`,
    )
  if (clean && homeAfter.lives.count !== homeBefore.lives.count)
    rec.bug(`hearts changed in a perfect lesson: ${homeBefore.lives.count} -> ${homeAfter.lives.count}`)
  const stateAfter = await levelState(request, guest, spec.level)
  extra.levelStateAfter = stateAfter
  if (stateAfter !== 'completed' && stateAfter !== 'legendary')
    rec.bug(`${spec.level} is "${stateAfter}" on the path after the lesson`)
  console.log(
    `  [${rec.project}] ${spec.level}: xpTotal ${homeBefore.xpTotal} -> ${homeAfter.xpTotal}, ` +
      `screens ${String(extra.completeScreens)}, level ${stateAfter}`,
  )
}

for (const spec of LEVELS) {
  test(`${spec.level}: every challenge through the real renderers`, async ({
    guestPage: page,
    guest,
    request,
  }, testInfo) => {
    const rec = new Recorder(page, testInfo, spec.level)
    const extra: Record<string, unknown> = { prereqs: spec.prereqs, guest: guest.userId }
    try {
      await playLevel(page, request, guest, rec, spec, extra)
    } catch (e) {
      rec.bug(`the run stopped: ${brief(e)}`)
      await rec.shot('stopped')
    } finally {
      await rec.finish(extra)
    }
    expect(rec.bugs.map((b) => `${b.step}: ${b.what}`)).toEqual([])
  })
}
