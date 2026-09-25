/**
 * Walking skeleton (API level): a guest plays the fixture course's first lesson end to end —
 * dev auth → create session → complete → XP, streak and level progress persisted.
 */
import { expect, test, type APIRequestContext } from '@playwright/test'

interface Graph {
  start: number
  accept: number[]
  edges: { from: number; to: number; t: string }[]
}
interface Challenge {
  type: string
  answer?: number
  graph?: Graph
  pairs?: unknown[]
}

/** The first accepted path through an answer graph (the canonical solution). */
function canonical(graph: Graph): string[] {
  const words: string[] = []
  let node = graph.start
  const accept = new Set(graph.accept)
  for (let guard = 0; !accept.has(node) && guard < 100; guard++) {
    const edge = graph.edges.find((e) => e.from === node)
    if (!edge) throw new Error('dead end in answer graph')
    if (edge.t) words.push(edge.t)
    node = edge.to
  }
  return words
}

function correctResponse(c: Challenge): unknown {
  switch (c.type) {
    case 'select_translation':
      return { kind: 'choice', value: c.answer }
    case 'translate_bank':
      return { kind: 'tiles', value: canonical(c.graph!) }
    case 'translate_type':
      return { kind: 'text', value: canonical(c.graph!).join(' ') }
    case 'match_pairs':
      return { kind: 'pairs', value: c.pairs!.map((_, i) => [i, i]) }
    default:
      throw new Error(`no scripted answer for ${c.type}`)
  }
}

async function guest(
  request: APIRequestContext,
): Promise<{ authorization: string; userId: string }> {
  const res = await request.post('/api/dev/auth/anonymous')
  expect(res.status()).toBe(200)
  const body = (await res.json()) as {
    accessToken: string
    user: { id: string; isAnonymous: boolean }
  }
  expect(body.user.isAnonymous).toBe(true)
  return { authorization: `Bearer ${body.accessToken}`, userId: body.user.id }
}

async function startLesson(
  request: APIRequestContext,
  authorization: string,
  headers: Record<string, string> = {},
) {
  const res = await request.post('/api/sessions', {
    headers: { authorization, ...headers },
    data: { courseId: 'fixture', kind: 'lesson', levelId: 'u01-s0', tz: 'America/New_York' },
  })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as { sessionId: string; graderVersion: number; challenges: Challenge[] }
}

function perfectAnswers(challenges: Challenge[]) {
  return challenges.map((c, i) => ({
    index: i,
    attemptSeq: i,
    response: correctResponse(c),
    verdict: 'correct',
    ms: 1500,
    hinted: false,
  }))
}

test('meta reports the published content and the local auth mode', async ({ request }) => {
  const res = await request.get('/api/meta')
  expect(res.status()).toBe(200)
  const meta = (await res.json()) as { contentVersion: number; authMode: string }
  expect(meta.authMode).toBe('local')
  expect(meta.contentVersion).toBeGreaterThan(0)
})

test('a guest completes the first lesson and the XP, streak and level progress stick', async ({
  request,
}) => {
  const { authorization } = await guest(request)
  const session = await startLesson(request, authorization)
  expect(session.challenges.map((c) => c.type)).toEqual([
    'select_translation',
    'translate_bank',
    'translate_type',
    'match_pairs',
  ])

  const complete = () =>
    request.post(`/api/sessions/${session.sessionId}/complete`, {
      headers: { authorization },
      data: {
        answers: perfectAnswers(session.challenges),
        completedAt: new Date().toISOString(),
        graderVersion: session.graderVersion,
      },
    })
  const res = await complete()
  expect(res.status(), await res.text()).toBe(200)
  const result = (await res.json()) as Record<string, unknown>
  expect(result).toMatchObject({
    kind: 'lesson',
    xp: { base: 10, bonus: 5, total: 15 },
    perfect: true,
    accuracy: 1,
    graderMismatches: 0,
    streak: { current: 1, extendedToday: true },
    level: { levelId: 'u01-s0', lessonsDone: 1, lessonsTotal: 1, completed: true },
  })

  // Replaying /complete returns the stored result and adds nothing.
  const replay = await complete()
  expect(replay.status()).toBe(200)
  expect(await replay.json()).toEqual(result)

  const home = await request.get('/api/home', { headers: { authorization } })
  expect(home.status()).toBe(200)
  expect(await home.json()).toMatchObject({
    user: { isAnonymous: true },
    course: { id: 'fixture' },
    xpTotal: 15,
    streak: { current: 1, status: 'extended' },
    dailyGoal: { xp: 15 },
  })
})

test('the server re-grades: a wrong answer claimed as correct is counted as a mismatch', async ({
  request,
}) => {
  const { authorization } = await guest(request)
  const session = await startLesson(request, authorization)
  const answers = perfectAnswers(session.challenges)
  answers[2] = { ...answers[2]!, response: { kind: 'text', value: 'Dad is bad' } }
  const res = await request.post(`/api/sessions/${session.sessionId}/complete`, {
    headers: { authorization },
    data: { answers, completedAt: new Date().toISOString(), graderVersion: session.graderVersion },
  })
  expect(res.status(), await res.text()).toBe(200)
  expect(await res.json()).toMatchObject({ graderMismatches: 1 })
})

test('requests without a token, with a bad token, or for another user are refused', async ({
  request,
}) => {
  expect((await request.get('/api/home')).status()).toBe(401)
  expect(
    (await request.get('/api/home', { headers: { authorization: 'Bearer nope' } })).status(),
  ).toBe(401)

  const alice = await guest(request)
  const bob = await guest(request)
  const session = await startLesson(request, alice.authorization)
  const res = await request.post(`/api/sessions/${session.sessionId}/complete`, {
    headers: { authorization: bob.authorization },
    data: {
      answers: perfectAnswers(session.challenges),
      completedAt: new Date().toISOString(),
      graderVersion: session.graderVersion,
    },
  })
  expect(res.status()).toBe(404)
  expect(await res.json()).toMatchObject({ error: { code: 'not_found' } })
})

test('an expired session cannot be completed (x-test-now time travel)', async ({ request }) => {
  const { authorization } = await guest(request)
  const session = await startLesson(request, authorization)
  const later = new Date(Date.now() + 25 * 3_600_000).toISOString()
  const res = await request.post(`/api/sessions/${session.sessionId}/complete`, {
    headers: { authorization, 'x-test-now': later },
    data: {
      answers: perfectAnswers(session.challenges),
      completedAt: later,
      graderVersion: session.graderVersion,
    },
  })
  expect(res.status()).toBe(410)
})

test('invalid requests get the validation error envelope', async ({ request }) => {
  const { authorization } = await guest(request)
  const res = await request.post('/api/sessions', {
    headers: { authorization },
    data: { kind: 'nope' },
  })
  expect(res.status()).toBe(400)
  expect(await res.json()).toMatchObject({ error: { code: 'validation' } })
})
