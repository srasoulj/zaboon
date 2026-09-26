/**
 * POST /api/speech/transcribe (flags.speak) on the fixture's u01-v1: the flag gate, session and
 * challenge validation (incl. IDOR), AppConfig.speech limits (real audio is a mono 16-bit PCM WAV
 * whose duration the server measures), the daily quota and when it is given back, the signing
 * check before anything is spent, the provider path through @zaboon/ai (MockTransport) and that
 * the audio is never stored.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AiHttpError, AiTimeoutError, chatResponse, MODELS, MockTransport } from '@zaboon/ai'
import { TEST_TRANSCRIPT_PREFIX } from '@zaboon/contracts'
import { resetServerEnv } from '../../lib/server/env'
import { setTranscriptionTransportForTests } from '../../lib/server/speech/transcriber'
import { verifySpeechToken } from '../../lib/server/speech/token'
import { encodeWav, pcm16Wav } from '../../lib/speech/wav'
import { finish, start } from '../api/flows'
import { createHarness, type Harness, type TestUser } from '../api/harness'
import {
  reachV1,
  setSpeechConfig,
  speakIndexes,
  startV1,
  startV1Raw,
  tablesContaining,
  transcribeCall,
  transcribeOk,
  usageOf,
  v1Answers,
} from './support'

let h: Harness
let alice: TestUser
beforeAll(async () => {
  h = await createHarness()
  alice = await reachV1(h)
}, 120_000)
afterAll(async () => {
  await h?.close()
})

describe('u01-v1 with flags.speak', () => {
  it('builds the speak pins with the flag on, their listen_tap twins with it off or paused', async () => {
    const on = await startV1(h, alice)
    expect(on.challenges.map((c) => c.type).sort()).toEqual(['listen_tap', 'speak', 'speak'])
    const speak = on.challenges.find((c) => c.type === 'speak')!
    expect(speak).toMatchObject({ prompt: { fa: expect.any(String) }, graph: expect.any(Object) })

    const variants: Parameters<typeof startV1>[2][] = [
      { flags: {} },
      { flags: { speak: false } },
      { speakPaused: true },
    ]
    for (const o of variants) {
      const off = await startV1(h, alice, o)
      expect(
        off.challenges.map((c) => c.type),
        JSON.stringify(o),
      ).toEqual(['listen_tap', 'listen_tap', 'listen_tap'])
    }
    // speakPaused: false changes nothing.
    const notPaused = await startV1(h, alice, { speakPaused: false })
    expect(speakIndexes(notPaused)).toHaveLength(2)
  })
})

describe('POST /api/speech/transcribe', () => {
  it('answers 404 while flags.speak is off', async () => {
    const s = await startV1(h, alice)
    const [i] = speakIndexes(s)
    for (const flags of [{}, { speak: false }] as Record<string, boolean>[]) {
      const res = await transcribeCall(
        h,
        alice,
        { sessionId: s.sessionId, index: i!, text: 'سلام' },
        { flags },
      )
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('not_found')
    }
    expect(await usageOf(h, alice.id)).toBe(0)
  })

  it('transcribes local test audio into a signed token and counts it against the quota', async () => {
    const bob = await reachV1(h)
    const s = await startV1(h, bob)
    const [i] = speakIndexes(s)
    const res = await transcribeOk(h, bob, s, i!, '  سلام، خوبی؟ ')
    expect(res).toEqual({ transcript: 'سلام، خوبی؟', token: expect.any(String), remaining: 59 })
    expect(res.token.length).toBeLessThanOrEqual(400)
    expect(
      verifySpeechToken(
        res.token,
        { userId: bob.id, sessionId: s.sessionId, index: i!, transcript: 'سلام، خوبی؟' },
        new Date(),
      ),
    ).toBe(true)
    expect(await usageOf(h, bob.id)).toBe(1)
    expect((await transcribeOk(h, bob, s, i!, 'سلام')).remaining).toBe(58)
  })

  it('caps the transcript at 500 characters', async () => {
    const s = await startV1(h, alice)
    const res = await transcribeOk(h, alice, s, speakIndexes(s)[0]!, 'آ'.repeat(700))
    expect(res.transcript).toBe('آ'.repeat(500))
  })

  it('never stores the audio (only a counter row; no table holds the upload)', async () => {
    const carol = await h.guest()
    expect((await startV1Raw(h, carol)).status).toBe(403) // u01-v1 is locked for a new guest
    const bob = await reachV1(h)
    const v = await startV1(h, bob)
    const marker = `unique-utterance-${crypto.randomUUID()}`
    const audio = Buffer.from(TEST_TRANSCRIPT_PREFIX + marker, 'utf8').toString('base64')
    const res = await transcribeCall(h, bob, {
      sessionId: v.sessionId,
      index: speakIndexes(v)[0]!,
      audio,
    })
    expect(res.status).toBe(200)
    expect(await tablesContaining(h, audio)).toEqual([])
    expect(await tablesContaining(h, marker)).toEqual([])
    expect(await tablesContaining(h, TEST_TRANSCRIPT_PREFIX)).toEqual([])
  })

  describe('validation', () => {
    it("another learner's session is 404 (IDOR) and costs nobody quota", async () => {
      const s = await startV1(h, alice)
      const mallory = await h.guest()
      const before = await usageOf(h, alice.id)
      const res = await transcribeCall(h, mallory, {
        sessionId: s.sessionId,
        index: speakIndexes(s)[0]!,
        text: 'سلام',
      })
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('not_found')
      expect(await usageOf(h, mallory.id)).toBe(0)
      expect(await usageOf(h, alice.id)).toBe(before)
      const unknown = await transcribeCall(h, alice, {
        sessionId: crypto.randomUUID(),
        index: 0,
        text: 'x',
      })
      expect(unknown.status).toBe(404)
    })

    it('a completed session is 409, an expired one 410', async () => {
      const bob = await reachV1(h)
      const s = await startV1(h, bob)
      const [i] = speakIndexes(s)
      const expired = await transcribeCall(
        h,
        bob,
        { sessionId: s.sessionId, index: i!, text: 'سلام' },
        { now: new Date(Date.parse(s.expiresAt) + 1000).toISOString() },
      )
      expect(expired.status).toBe(410)
      expect(expired.body.error.code).toBe('gone')

      const t = await startV1(h, bob)
      await finish(h, bob, t, {
        answers: v1Answers(t, () => ({ kind: 'audio', transcript: '', declined: true })),
      })
      const done = await transcribeCall(h, bob, {
        sessionId: t.sessionId,
        index: speakIndexes(t)[0]!,
        text: 'سلام',
      })
      expect(done.status).toBe(409)
      expect(done.body.error.code).toBe('conflict')
      expect(await usageOf(h, bob.id)).toBe(0)
    })

    it('an index that is not a speak challenge (or out of range) is 400', async () => {
      const s = await startV1(h, alice)
      const listen = s.challenges.find((c) => c.type === 'listen_tap')!.index
      const before = await usageOf(h, alice.id)
      for (const index of [listen, s.challenges.length, 199]) {
        const res = await transcribeCall(h, alice, { sessionId: s.sessionId, index, text: 'سلام' })
        expect(res.status, `index ${index}`).toBe(400)
        expect(res.body.error.code).toBe('validation')
      }
      // A session with no speak challenge at all (the first lesson, flag on).
      const mvp = await start(h, alice)
      const res = await transcribeCall(h, alice, {
        sessionId: mvp.sessionId,
        index: 0,
        text: 'سلام',
      })
      expect(res.status).toBe(400)
      // A paused session carries listen_tap twins only.
      const paused = await startV1(h, alice, { speakPaused: true })
      const p = await transcribeCall(h, alice, {
        sessionId: paused.sessionId,
        index: 0,
        text: 'سلام',
      })
      expect(p.status).toBe(400)
      expect(await usageOf(h, alice.id)).toBe(before)
    })

    it('enforces AppConfig.speech size and duration (400) and the contract format and encoding', async () => {
      await setSpeechConfig(h, { maxAudioBytes: 64, maxDurationMs: 2000 })
      try {
        const s = await startV1(h, alice)
        const index = speakIndexes(s)[0]!
        const before = await usageOf(h, alice.id)
        const cases: [string, Parameters<typeof transcribeCall>[2]][] = [
          ['too big', { sessionId: s.sessionId, index, text: 'س'.repeat(40) }],
          ['too long', { sessionId: s.sessionId, index, text: 'سلام', durationMs: 2001 }],
          ['unknown format', { sessionId: s.sessionId, index, text: 'سلام', format: 'ogg' }],
          ['not base64', { sessionId: s.sessionId, index, audio: 'not base64!' }],
          ['empty', { sessionId: s.sessionId, index, audio: '' }],
        ]
        for (const [name, input] of cases) {
          const res = await transcribeCall(h, alice, input)
          expect(res.status, name).toBe(400)
          expect(res.body.error.code, name).toBe('validation')
        }
        const ok = await transcribeCall(h, alice, {
          sessionId: s.sessionId,
          index,
          text: 'سلام',
          durationMs: 2000,
        })
        expect(ok.status, JSON.stringify(ok.body)).toBe(200)
        expect(await usageOf(h, alice.id)).toBe(before + 1)
      } finally {
        await setSpeechConfig(h)
      }
    })
  })

  describe('daily quota', () => {
    it('refuses with 429 quota_exceeded once used up, without counting further; a new UTC day resets it', async () => {
      await setSpeechConfig(h, { dailyQuota: 2 })
      try {
        const dave = await reachV1(h)
        const day1 = '2026-10-01T23:50:00.000Z'
        const day2 = '2026-10-02T00:05:00.000Z'
        const s = await startV1(h, dave, { now: day1 })
        const index = speakIndexes(s)[0]!
        const call = (now: string) =>
          transcribeCall(h, dave, { sessionId: s.sessionId, index, text: 'سلام' }, { now })
        expect((await call(day1)).body.remaining).toBe(1)
        expect((await call(day1)).body.remaining).toBe(0)
        const over = await call(day1)
        expect(over.status).toBe(429)
        expect(over.body.error.code).toBe('quota_exceeded')
        expect(await usageOf(h, dave.id)).toBe(2)
        const next = await call(day2)
        expect(next.status, JSON.stringify(next.body)).toBe(200)
        expect(next.body.remaining).toBe(1)
        const rows = await h.sql`
          SELECT day::text AS day, count FROM speech_usage WHERE user_id = ${dave.id} ORDER BY day`
        expect(rows.map((r) => [r.day, r.count])).toEqual([
          ['2026-10-01', 2],
          ['2026-10-02', 1],
        ])
      } finally {
        await setSpeechConfig(h)
      }
    })

    it('never overspends under concurrent requests', async () => {
      await setSpeechConfig(h, { dailyQuota: 3 })
      try {
        const erin = await reachV1(h)
        const s = await startV1(h, erin)
        const index = speakIndexes(s)[0]!
        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            transcribeCall(h, erin, { sessionId: s.sessionId, index, text: 'سلام' }),
          ),
        )
        expect(results.filter((r) => r.status === 200)).toHaveLength(3)
        expect(results.filter((r) => r.status === 429)).toHaveLength(5)
        expect(await usageOf(h, erin.id)).toBe(3)
      } finally {
        await setSpeechConfig(h)
      }
    })
  })

  describe('the provider (OpenRouter through @zaboon/ai)', () => {
    const KEY = 'mock-openrouter-app-key-for-tests' // pragma: allowlist secret
    /** `ms` of a quiet tone as the browser uploads it: a 16 kHz mono 16-bit PCM WAV, base64. */
    const wavAudio = (ms: number) =>
      Buffer.from(encodeWav(new Float32Array(16 * ms).fill(0.1))).toString('base64')
    const realAudio = wavAudio(1500)

    const withKey = (key: string | undefined) => {
      if (key === undefined) delete process.env.OPENROUTER_API_KEY_APP
      else process.env.OPENROUTER_API_KEY_APP = key
      resetServerEnv()
    }
    afterEach(() => {
      setTranscriptionTransportForTests(null)
      withKey(undefined)
      vi.restoreAllMocks()
    })

    it('sends real audio to the app transcription model with data collection denied, no cache', async () => {
      withKey(KEY)
      const transport = new MockTransport(() => chatResponse('  سلام، خوبی؟  '))
      setTranscriptionTransportForTests(transport)
      const s = await startV1(h, alice)
      const index = speakIndexes(s)[0]!
      const res = await transcribeCall(h, alice, {
        sessionId: s.sessionId,
        index,
        audio: realAudio,
        format: 'wav',
      })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.transcript).toBe('سلام، خوبی؟')
      expect(transport.calls).toHaveLength(1)
      const req = transport.calls[0]!
      expect(req.model).toBe(MODELS.app_transcribe)
      expect(req.provider).toEqual({ data_collection: 'deny' })
      const parts = req.messages[0]!.content as {
        type: string
        text?: string
        input_audio?: unknown
      }[]
      expect(parts.find((p) => p.type === 'text')!.text).toContain('Persian (Farsi)')
      // The canonical copy of a canonical WAV is the same bytes.
      expect(parts.find((p) => p.type === 'input_audio')!.input_audio).toEqual({
        data: realAudio,
        format: 'wav',
      })
      // A second identical upload calls the provider again (no response cache).
      await transcribeCall(h, alice, {
        sessionId: s.sessionId,
        index,
        audio: realAudio,
        format: 'wav',
      })
      expect(transport.calls).toHaveLength(2)
      // Local test audio never reaches the provider.
      await transcribeCall(h, alice, { sessionId: s.sessionId, index, text: 'سلام' })
      expect(transport.calls).toHaveLength(2)
    })

    it('a provider refusal (an HTTP error status) is 503 and gives the quota back; no audio is logged', async () => {
      withKey(KEY)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const s = await startV1(h, alice)
      const index = speakIndexes(s)[0]!
      const before = await usageOf(h, alice.id)
      for (const status of [400, 429, 502]) {
        setTranscriptionTransportForTests(
          new MockTransport(() => {
            throw new AiHttpError(status, `upstream echoed ${realAudio}`)
          }),
        )
        const res = await transcribeCall(h, alice, {
          sessionId: s.sessionId,
          index,
          audio: realAudio,
          format: 'wav',
        })
        expect(res.status, JSON.stringify(res.body)).toBe(503)
        expect(res.body.error.code).toBe('unavailable')
        expect(JSON.stringify(res.body)).not.toContain(realAudio)
      }
      expect(await usageOf(h, alice.id)).toBe(before)
      const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls])
      expect(logged).not.toContain(realAudio)
      expect(warn).toHaveBeenCalled()
    })

    it('an answer keeps the count: an empty transcript is 200 "", and a timeout, lost connection or error inside a 200 is 503 without a refund', async () => {
      withKey(KEY)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const s = await startV1(h, alice)
      const index = speakIndexes(s)[0]!
      const before = await usageOf(h, alice.id)
      const call = () =>
        transcribeCall(h, alice, { sessionId: s.sessionId, index, audio: realAudio, format: 'wav' })

      // Silence: the model heard nothing. The learner sees "didn't catch that" and may try again;
      // the answer was billed, so it counts (a script can't transcribe for free with silence).
      setTranscriptionTransportForTests(new MockTransport(() => chatResponse('')))
      const empty = await call()
      expect(empty.status, JSON.stringify(empty.body)).toBe(200)
      expect(empty.body.transcript).toBe('')
      const bound = { userId: alice.id, sessionId: s.sessionId, index, transcript: '' }
      expect(verifySpeechToken(empty.body.token, bound, new Date())).toBe(true)
      expect(await usageOf(h, alice.id)).toBe(before + 1)

      for (const fail of [
        () => {
          throw new AiTimeoutError('OpenRouter request timed out after 20000 ms')
        },
        () => {
          throw new Error(`network down ${realAudio}`)
        },
        () => {
          throw new AiHttpError(502, 'provider failed mid-answer', true)
        },
      ]) {
        setTranscriptionTransportForTests(new MockTransport(fail))
        const res = await call()
        expect(res.status, JSON.stringify(res.body)).toBe(503)
        expect(res.body.error.code).toBe('unavailable')
        expect(JSON.stringify(res.body)).not.toContain(realAudio)
      }
      expect(await usageOf(h, alice.id)).toBe(before + 4)
      expect(JSON.stringify(warn.mock.calls)).not.toContain(realAudio)
    })

    it('real audio must be a mono 16-bit PCM WAV, measured by the server (400, nothing spent)', async () => {
      withKey(KEY)
      const transport = new MockTransport(() => chatResponse('سلام'))
      setTranscriptionTransportForTests(transport)
      await setSpeechConfig(h, { maxDurationMs: 2000 })
      try {
        const s = await startV1(h, alice)
        const index = speakIndexes(s)[0]!
        const before = await usageOf(h, alice.id)
        const stereo = Buffer.from(encodeWav(new Float32Array(3200)))
        stereo.writeUInt16LE(2, 22) // channels
        stereo.writeUInt32LE(64_000, 28) // byte rate
        stereo.writeUInt16LE(4, 32) // block align
        const trailing = Buffer.concat([
          Buffer.from(encodeWav(new Float32Array(1600))),
          Buffer.alloc(40_000, 1), // audio the header doesn't count
        ])
        const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
        const cases: [string, Parameters<typeof transcribeCall>[2]][] = [
          ['webm', { sessionId: s.sessionId, index, audio: wavAudio(500), format: 'webm' }],
          ['m4a', { sessionId: s.sessionId, index, audio: wavAudio(500), format: 'm4a' }],
          [
            'not a wav',
            {
              sessionId: s.sessionId,
              index,
              audio: b64(Buffer.from('RIFF....WAVEfmt nope')),
              format: 'wav',
            },
          ],
          ['stereo', { sessionId: s.sessionId, index, audio: b64(stereo), format: 'wav' }],
          [
            'trailing bytes',
            { sessionId: s.sessionId, index, audio: b64(trailing), format: 'wav' },
          ],
          [
            'no samples',
            {
              sessionId: s.sessionId,
              index,
              audio: b64(pcm16Wav(new Uint8Array(0), 16_000)),
              format: 'wav',
            },
          ],
          // 2.5 s of audio declared as 1 s: the server measures it.
          [
            'longer than declared',
            {
              sessionId: s.sessionId,
              index,
              audio: wavAudio(2500),
              format: 'wav',
              durationMs: 1000,
            },
          ],
        ]
        for (const [name, input] of cases) {
          const res = await transcribeCall(h, alice, input)
          expect(res.status, name).toBe(400)
          expect(res.body.error.code, name).toBe('validation')
        }
        expect(transport.calls).toHaveLength(0)
        expect(await usageOf(h, alice.id)).toBe(before)
        // Exactly the limit passes, whatever the client declares (it can't shorten the audio).
        const ok = await transcribeCall(h, alice, {
          sessionId: s.sessionId,
          index,
          audio: wavAudio(2000),
          format: 'wav',
          durationMs: 0,
        })
        expect(ok.status, JSON.stringify(ok.body)).toBe(200)
        expect(transport.calls).toHaveLength(1)
      } finally {
        await setSpeechConfig(h)
      }
    })

    it('without a usable signing secret: 503 before any quota is taken or the provider is called', async () => {
      withKey(KEY)
      const transport = new MockTransport(() => chatResponse('سلام'))
      setTranscriptionTransportForTests(transport)
      const saved = process.env.APP_SIGNING_SECRET
      process.env.APP_SIGNING_SECRET = 'too-short' // pragma: allowlist secret
      resetServerEnv()
      try {
        const s = await startV1(h, alice)
        const index = speakIndexes(s)[0]!
        const before = await usageOf(h, alice.id)
        for (const input of [
          { sessionId: s.sessionId, index, audio: realAudio, format: 'wav' },
          { sessionId: s.sessionId, index, text: 'سلام' },
        ]) {
          const res = await transcribeCall(h, alice, input)
          expect(res.status, JSON.stringify(res.body)).toBe(503)
          expect(res.body.error.code).toBe('unavailable')
        }
        expect(transport.calls).toHaveLength(0)
        expect(await usageOf(h, alice.id)).toBe(before)
      } finally {
        if (saved === undefined) delete process.env.APP_SIGNING_SECRET
        else process.env.APP_SIGNING_SECRET = saved
        resetServerEnv()
      }
    })

    it('without OPENROUTER_API_KEY_APP real audio is 503 unavailable and costs no quota; test audio still works', async () => {
      withKey(undefined)
      const transport = new MockTransport(() => chatResponse('سلام'))
      setTranscriptionTransportForTests(transport)
      const s = await startV1(h, alice)
      const index = speakIndexes(s)[0]!
      const before = await usageOf(h, alice.id)
      const res = await transcribeCall(h, alice, {
        sessionId: s.sessionId,
        index,
        audio: realAudio,
        format: 'wav',
      })
      expect(res.status).toBe(503)
      expect(res.body.error.code).toBe('unavailable')
      expect(transport.calls).toHaveLength(0)
      expect(await usageOf(h, alice.id)).toBe(before)
      expect(
        (await transcribeCall(h, alice, { sessionId: s.sessionId, index, text: 'سلام' })).status,
      ).toBe(200)
    })
  })
})
